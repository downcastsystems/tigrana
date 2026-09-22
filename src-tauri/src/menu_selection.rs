//! Native check items toggle independently. Navigation is a single choice.
pub const NAVIGATION_ITEMS: [&str; 3] = [
    "navigation_dual_pane",
    "navigation_section_view",
    "navigation_single_pane",
];

pub fn select_navigation_item<E>(
    command: &str,
    mut set_checked: impl FnMut(&str, bool) -> Result<(), E>,
) -> Result<(), E> {
    if !NAVIGATION_ITEMS.contains(&command) {
        return Ok(());
    }
    // Set every item, including the clicked one: clicking the current choice
    // must undo the native automatic uncheck, even if React state is unchanged.
    for id in NAVIGATION_ITEMS {
        set_checked(id, id == command)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn navigation_remains_exclusive_after_native_toggles_and_repeated_clicks() {
        let mut checks: HashMap<_, _> = NAVIGATION_ITEMS
            .into_iter()
            .map(|id| (id, id == "navigation_section_view"))
            .collect();
        for clicked in [
            "navigation_dual_pane",
            "navigation_single_pane",
            "navigation_single_pane",
            "navigation_section_view",
            "navigation_dual_pane",
            "navigation_dual_pane",
        ] {
            // Reproduce the native library's automatic checkbox toggle first.
            *checks.get_mut(clicked).unwrap() ^= true;
            select_navigation_item(clicked, |id, checked| {
                *checks.get_mut(id).unwrap() = checked;
                Ok::<_, ()>(())
            })
            .unwrap();
            assert!(checks[clicked]);
            assert_eq!(checks.values().filter(|checked| **checked).count(), 1);
        }
    }

    #[test]
    fn unrelated_commands_leave_navigation_alone() {
        select_navigation_item("toggle_outline", |_, _| -> Result<(), ()> {
            panic!("An unrelated checkbox must not affect navigation")
        })
        .unwrap();
    }
}
