#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cartographer_tauri_lib::run();
}
