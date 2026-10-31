fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        // whisper.cpp (Metal) nutzt @available(...) → braucht die Laufzeit-Hilfen von clang (___isPlatformVersionAtLeast)
        if let Ok(out) = std::process::Command::new("clang")
            .arg("--print-resource-dir")
            .output()
        {
            let dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !dir.is_empty() {
                println!("cargo:rustc-link-search=native={dir}/lib/darwin");
                println!("cargo:rustc-link-lib=static=clang_rt.osx");
            }
        }
        build_apple_speech();
    }
    tauri_build::build()
}

/// Apples Spracherkennung: kleine Swift-Datei → statische Bibliothek, die Rust direkt aufruft
fn build_apple_speech() {
    let src = "apple/AppleSpeech.swift";
    println!("cargo:rerun-if-changed={src}");
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        _ => "x86_64",
    };
    let target = format!("{arch}-apple-macosx11.0");
    let lib = out.join("libapplespeech.a");
    let status = std::process::Command::new("xcrun")
        .args(["swiftc", "-emit-library", "-static", "-parse-as-library", "-O", "-module-name", "AppleSpeech", "-target", &target])
        .arg("-o")
        .arg(&lib)
        .arg(src)
        .status()
        .expect("swiftc nicht gefunden (Xcode-Kommandozeilenwerkzeuge installieren)");
    assert!(status.success(), "Swift-Teil (Apple-Spracherkennung) ließ sich nicht bauen");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=applespeech");
    println!("cargo:rustc-link-lib=framework=Speech");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=Foundation");
    // Swift-Laufzeit: liegt im System (/usr/lib/swift); Kompatibilitäts-Bibliotheken liegen bei Xcode
    if let Ok(info) = std::process::Command::new("xcrun")
        .args(["swiftc", "-print-target-info", "-target", &target])
        .output()
    {
        let text = String::from_utf8_lossy(&info.stdout).to_string();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            for key in ["runtimeLibraryPaths", "runtimeLibraryImportPaths"] {
                if let Some(paths) = v["paths"][key].as_array() {
                    for p in paths.iter().filter_map(|p| p.as_str()) {
                        println!("cargo:rustc-link-search=native={p}");
                    }
                }
            }
        }
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
