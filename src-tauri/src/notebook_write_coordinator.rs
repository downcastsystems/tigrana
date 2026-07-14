use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct NotebookWriteCoordinator {
    locks: Arc<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>>,
}

impl NotebookWriteCoordinator {
    pub fn run<T, F>(&self, root: &Path, operation: F) -> Result<T, String>
    where
        F: FnOnce() -> Result<T, String>,
    {
        let key = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let lock = {
            let mut locks = self.locks.lock().map_err(|error| error.to_string())?;
            Arc::clone(locks.entry(key).or_insert_with(|| Arc::new(Mutex::new(()))))
        };
        let _guard = lock.lock().map_err(|error| error.to_string())?;
        operation()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::link_index::{read_link_index_file, rebuild_index_for_root};
    use crate::notebook_storage::{move_note, save_note};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::Duration;
    use uuid::Uuid;

    struct TestNotebook(PathBuf);

    impl TestNotebook {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("tigrana-write-coordinator-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn write_note(&self, path: &str, id: &str, body: &str) {
            let absolute = self.0.join(path);
            fs::create_dir_all(absolute.parent().unwrap()).unwrap();
            fs::write(absolute, format!("---\nid: {id}\n---\n\n{body}\n")).unwrap();
        }
    }

    impl Drop for TestNotebook {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn serializes_a_save_before_a_move_in_the_same_notebook() {
        let notebook = TestNotebook::new();
        notebook.write_note("Draft.md", "draft-id", "old body");
        fs::create_dir_all(notebook.0.join("Archive")).unwrap();
        rebuild_index_for_root(&notebook.0).unwrap();

        let coordinator = Arc::new(NotebookWriteCoordinator::default());
        let (save_entered_tx, save_entered_rx) = mpsc::channel();
        let (release_save_tx, release_save_rx) = mpsc::channel();
        let (move_entered_tx, move_entered_rx) = mpsc::channel();

        let save_root = notebook.0.clone();
        let save_coordinator = Arc::clone(&coordinator);
        let save_thread = thread::spawn(move || {
            save_coordinator.run(&save_root, || {
                save_entered_tx.send(()).unwrap();
                release_save_rx.recv().unwrap();
                save_note(
                    &save_root,
                    "Draft.md",
                    "---\nid: draft-id\n---\n\nnew body\n",
                )
                .map(|_| ())
            })
        });
        save_entered_rx.recv().unwrap();

        let move_root = notebook.0.clone();
        let move_coordinator = Arc::clone(&coordinator);
        let move_thread = thread::spawn(move || {
            move_coordinator.run(&move_root, || {
                move_entered_tx.send(()).unwrap();
                move_note(&move_root, "Draft.md", "Archive").map(|_| ())
            })
        });

        let move_started_before_save_finished = move_entered_rx
            .recv_timeout(Duration::from_millis(100))
            .is_ok();
        release_save_tx.send(()).unwrap();
        save_thread.join().unwrap().unwrap();
        move_thread.join().unwrap().unwrap();

        assert!(!move_started_before_save_finished);
        assert!(!notebook.0.join("Draft.md").exists());
        assert!(fs::read_to_string(notebook.0.join("Archive/Draft.md"))
            .unwrap()
            .contains("new body"));
        let index = read_link_index_file(&notebook.0);
        assert!(!index.path_to_id.contains_key("Draft.md"));
        assert_eq!(
            index.path_to_id.get("Archive/Draft.md").map(String::as_str),
            Some("draft-id")
        );
    }

    #[test]
    fn serializes_concurrent_saves_in_the_same_notebook() {
        let notebook = TestNotebook::new();
        notebook.write_note("First.md", "first-id", "first");
        notebook.write_note("Second.md", "second-id", "second");
        notebook.write_note("Target.md", "target-id", "target");
        rebuild_index_for_root(&notebook.0).unwrap();

        let coordinator = Arc::new(NotebookWriteCoordinator::default());
        let (first_entered_tx, first_entered_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let (second_entered_tx, second_entered_rx) = mpsc::channel();

        let first_root = notebook.0.clone();
        let first_coordinator = Arc::clone(&coordinator);
        let first_thread = thread::spawn(move || {
            first_coordinator.run(&first_root, || {
                first_entered_tx.send(()).unwrap();
                release_first_rx.recv().unwrap();
                save_note(
                    &first_root,
                    "First.md",
                    "---\nid: first-id\n---\n\n[Target](Target.md)\n",
                )
                .map(|_| ())
            })
        });
        first_entered_rx.recv().unwrap();

        let second_root = notebook.0.clone();
        let second_coordinator = Arc::clone(&coordinator);
        let second_thread = thread::spawn(move || {
            second_coordinator.run(&second_root, || {
                second_entered_tx.send(()).unwrap();
                save_note(
                    &second_root,
                    "Second.md",
                    "---\nid: second-id\n---\n\n[Target](Target.md)\n",
                )
                .map(|_| ())
            })
        });

        let second_started_before_first_finished = second_entered_rx
            .recv_timeout(Duration::from_millis(100))
            .is_ok();
        release_first_tx.send(()).unwrap();
        first_thread.join().unwrap().unwrap();
        second_thread.join().unwrap().unwrap();

        assert!(!second_started_before_first_finished);
        let index = read_link_index_file(&notebook.0);
        assert!(index.outbound.contains_key("first-id"));
        assert!(index.outbound.contains_key("second-id"));
        assert_eq!(index.inbound.get("target-id").map(Vec::len), Some(2));
    }
}
