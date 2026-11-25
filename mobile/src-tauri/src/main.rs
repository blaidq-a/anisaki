// Desktop entry, only for trying the phone build on a computer; the Android app starts from lib.rs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  anisaki_mobile_lib::run()
}
