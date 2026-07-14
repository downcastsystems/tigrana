use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct NotebookWriteCoordinator {
    locks: Arc<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>>,
}

impl NotebookWriteCoordinator {
    fn lane_for(&self, root: &Path) -> Result<Arc<Mutex<()>>, String> {
        let key = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let mut locks = self.locks.lock().map_err(|error| error.to_string())?;
        Ok(Arc::clone(
            locks.entry(key).or_insert_with(|| Arc::new(Mutex::new(()))),
        ))
    }

    pub fn run<T, F>(&self, root: &Path, operation: F) -> Result<T, String>
    where
        F: FnOnce() -> Result<T, String>,
    {
        let lock = self.lane_for(root)?;
        let _guard = lock.lock().map_err(|error| error.to_string())?;
        operation()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, TryLockError};
    use uuid::Uuid;

    struct TestNotebook(PathBuf);

    impl TestNotebook {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("tigrana-write-coordinator-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestNotebook {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn canonical_aliases_share_one_lane() {
        let notebook = TestNotebook::new();
        let coordinator = NotebookWriteCoordinator::default();

        let direct = coordinator.lane_for(&notebook.0).unwrap();
        let alias = coordinator.lane_for(&notebook.0.join(".")).unwrap();

        assert!(Arc::ptr_eq(&direct, &alias));
    }

    #[test]
    fn the_same_notebook_lane_blocks_until_its_guard_is_released() {
        let notebook = TestNotebook::new();
        let coordinator = NotebookWriteCoordinator::default();
        let lane = coordinator.lane_for(&notebook.0).unwrap();
        let same_lane = coordinator.lane_for(&notebook.0).unwrap();

        let guard = lane.lock().unwrap();
        assert!(matches!(
            same_lane.try_lock(),
            Err(TryLockError::WouldBlock)
        ));
        drop(guard);
        assert!(same_lane.try_lock().is_ok());
    }

    #[test]
    fn different_notebooks_use_independent_lanes() {
        let first = TestNotebook::new();
        let second = TestNotebook::new();
        let coordinator = NotebookWriteCoordinator::default();
        let first_lane = coordinator.lane_for(&first.0).unwrap();
        let second_lane = coordinator.lane_for(&second.0).unwrap();

        let _first_guard = first_lane.lock().unwrap();
        assert!(second_lane.try_lock().is_ok());
    }

    #[test]
    fn run_holds_the_canonical_lane_for_the_entire_operation() {
        let notebook = TestNotebook::new();
        let coordinator = NotebookWriteCoordinator::default();

        coordinator
            .run(&notebook.0.join("."), || {
                let canonical_lane = coordinator.lane_for(&notebook.0)?;
                assert!(matches!(
                    canonical_lane.try_lock(),
                    Err(TryLockError::WouldBlock)
                ));
                Ok(())
            })
            .unwrap();
    }
}
