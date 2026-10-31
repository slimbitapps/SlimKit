// Unter Windows kein zusätzliches Konsolenfenster öffnen
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Selbsttest für die automatischen Builds: `SlimVoice --selftest=small`
    if let Some(model) = std::env::args().find_map(|a| a.strip_prefix("--selftest=").map(|s| s.to_string())) {
        std::process::exit(slimvoice_lib::cli_selftest(&model));
    }
    slimvoice_lib::run()
}
