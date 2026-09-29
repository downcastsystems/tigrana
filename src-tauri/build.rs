fn main() {
    tauri_build::build();

    // tauri-build embeds the app manifest in binaries, but integration tests
    // need their own. Without Common Controls v6, the Windows loader cannot
    // resolve muda's TaskDialogIndirect import and exits before main runs.
    // See https://github.com/tauri-apps/tauri/issues/13419.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        let manifest = std::path::PathBuf::from(
            std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo package directory"),
        )
        .join("tests/windows.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
}
