// libmpv (mpv-2.dll) inside the app's own process: no separate mpv.exe, so Windows lists the player as
// part of Anisaki. The DLL is loaded at run time from vendor/mpv; commands and properties go through
// mpv's "node" API, so values keep their types (numbers, flags, lists) as the UI expects them.
use libloading::{Library, Symbol};
use serde_json::{json, Map, Value};
use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};
use std::path::Path;
use std::ptr;

#[repr(C)]
#[derive(Clone, Copy)]
union NodeU {
  string: *mut c_char,
  flag: c_int,
  int64: i64,
  double_: c_double,
  list: *mut NodeList,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Node {
  u: NodeU,
  format: c_int,
}
#[repr(C)]
struct NodeList {
  num: c_int,
  values: *mut Node,
  keys: *mut *mut c_char,
}
#[repr(C)]
struct Event {
  event_id: c_int,
  error: c_int,
  reply_userdata: u64,
  data: *mut c_void,
}
#[repr(C)]
struct EventProperty {
  name: *const c_char,
  format: c_int,
  data: *mut c_void,
}
#[repr(C)]
struct EventEndFile {
  reason: c_int,
  error: c_int,
}

const FMT_NONE: c_int = 0;
const FMT_STRING: c_int = 1;
const FMT_FLAG: c_int = 3;
const FMT_INT64: c_int = 4;
const FMT_DOUBLE: c_int = 5;
const FMT_NODE: c_int = 6;
const FMT_ARRAY: c_int = 7;
const FMT_MAP: c_int = 8;

type Handle = *mut c_void;
struct Api {
  create: unsafe extern "C" fn() -> Handle,
  initialize: unsafe extern "C" fn(Handle) -> c_int,
  terminate_destroy: unsafe extern "C" fn(Handle),
  set_option_string: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> c_int,
  command_node: unsafe extern "C" fn(Handle, *mut Node, *mut Node) -> c_int,
  set_property: unsafe extern "C" fn(Handle, *const c_char, c_int, *mut c_void) -> c_int,
  get_property: unsafe extern "C" fn(Handle, *const c_char, c_int, *mut c_void) -> c_int,
  observe_property: unsafe extern "C" fn(Handle, u64, *const c_char, c_int) -> c_int,
  wait_event: unsafe extern "C" fn(Handle, c_double) -> *mut Event,
  wakeup: unsafe extern "C" fn(Handle),
  free_node_contents: unsafe extern "C" fn(*mut Node),
  error_string: unsafe extern "C" fn(c_int) -> *const c_char,
  event_name: unsafe extern "C" fn(c_int) -> *const c_char,
}

static API: std::sync::OnceLock<Result<(Library, Api), String>> = std::sync::OnceLock::new();

fn api(dll: &Path) -> Result<&'static Api, String> {
  let r = API.get_or_init(|| unsafe {
    let lib = Library::new(dll).map_err(|e| format!("libmpv yüklenemedi: {e}"))?;
    macro_rules! f {
      ($n:literal) => {{
        let s: Symbol<_> = lib.get($n).map_err(|e| format!("libmpv: {e}"))?;
        *s
      }};
    }
    let api = Api {
      create: f!(b"mpv_create\0"),
      initialize: f!(b"mpv_initialize\0"),
      terminate_destroy: f!(b"mpv_terminate_destroy\0"),
      set_option_string: f!(b"mpv_set_option_string\0"),
      command_node: f!(b"mpv_command_node\0"),
      set_property: f!(b"mpv_set_property\0"),
      get_property: f!(b"mpv_get_property\0"),
      observe_property: f!(b"mpv_observe_property\0"),
      wait_event: f!(b"mpv_wait_event\0"),
      wakeup: f!(b"mpv_wakeup\0"),
      free_node_contents: f!(b"mpv_free_node_contents\0"),
      error_string: f!(b"mpv_error_string\0"),
      event_name: f!(b"mpv_event_name\0"),
    };
    Ok((lib, api))
  });
  r.as_ref().map(|(_, a)| a).map_err(|e| e.clone())
}

/* ------------------------------ JSON <-> node ------------------------------ */
/// Keeps the C strings and arrays of a node built from JSON alive while mpv reads it.
#[derive(Default)]
struct Arena {
  strings: Vec<CString>,
  nodes: Vec<Vec<Node>>,
  keys: Vec<Vec<*mut c_char>>,
  lists: Vec<Box<NodeList>>,
}
impl Arena {
  fn node(&mut self, v: &Value) -> Node {
    match v {
      Value::Null => Node { u: NodeU { int64: 0 }, format: FMT_NONE },
      Value::Bool(b) => Node { u: NodeU { flag: *b as c_int }, format: FMT_FLAG },
      Value::Number(n) if n.is_i64() => Node { u: NodeU { int64: n.as_i64().unwrap() }, format: FMT_INT64 },
      Value::Number(n) => Node { u: NodeU { double_: n.as_f64().unwrap_or(0.0) }, format: FMT_DOUBLE },
      Value::String(s) => {
        let c = CString::new(s.replace('\0', "")).unwrap();
        let p = c.as_ptr() as *mut c_char;
        self.strings.push(c);
        Node { u: NodeU { string: p }, format: FMT_STRING }
      }
      Value::Array(a) => {
        let mut vals: Vec<Node> = a.iter().map(|x| self.node(x)).collect();
        let list = Box::new(NodeList { num: vals.len() as c_int, values: vals.as_mut_ptr(), keys: ptr::null_mut() });
        self.nodes.push(vals);
        let p = &*list as *const NodeList as *mut NodeList;
        self.lists.push(list);
        Node { u: NodeU { list: p }, format: FMT_ARRAY }
      }
      Value::Object(o) => {
        let mut vals: Vec<Node> = Vec::new();
        let mut keys: Vec<*mut c_char> = Vec::new();
        for (k, x) in o {
          let c = CString::new(k.as_str()).unwrap();
          keys.push(c.as_ptr() as *mut c_char);
          self.strings.push(c);
          vals.push(self.node(x));
        }
        let list = Box::new(NodeList { num: vals.len() as c_int, values: vals.as_mut_ptr(), keys: keys.as_mut_ptr() });
        self.nodes.push(vals);
        self.keys.push(keys);
        let p = &*list as *const NodeList as *mut NodeList;
        self.lists.push(list);
        Node { u: NodeU { list: p }, format: FMT_MAP }
      }
    }
  }
}

unsafe fn to_json(n: &Node) -> Value {
  unsafe {
    match n.format {
      FMT_STRING => Value::String(CStr::from_ptr(n.u.string).to_string_lossy().into_owned()),
      FMT_FLAG => Value::Bool(n.u.flag != 0),
      FMT_INT64 => json!(n.u.int64),
      FMT_DOUBLE => json!(n.u.double_),
      FMT_ARRAY | FMT_MAP => {
        let l = &*n.u.list;
        // an empty list may come with null pointers
        if l.num <= 0 || l.values.is_null() {
          return if n.format == FMT_ARRAY { Value::Array(vec![]) } else { Value::Object(Map::new()) };
        }
        let vals = std::slice::from_raw_parts(l.values, l.num as usize);
        if n.format == FMT_ARRAY {
          Value::Array(vals.iter().map(|v| to_json(v)).collect())
        } else {
          if l.keys.is_null() {
            return Value::Object(Map::new());
          }
          let keys = std::slice::from_raw_parts(l.keys, l.num as usize);
          let mut m = Map::new();
          for (k, v) in keys.iter().zip(vals) {
            m.insert(CStr::from_ptr(*k).to_string_lossy().into_owned(), to_json(v));
          }
          Value::Object(m)
        }
      }
      _ => Value::Null,
    }
  }
}

/* --------------------------------- player --------------------------------- */
pub struct Mpv {
  api: &'static Api,
  h: Handle,
}
unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

pub enum Ev {
  Prop(String, Value),
  Event(String, Value),
  Shutdown,
}

impl Mpv {
  /// Creates and starts an mpv instance with these options (names without "--").
  pub fn new(dll: &Path, options: &[(String, String)]) -> Result<Mpv, String> {
    let api = api(dll)?;
    unsafe {
      let h = (api.create)();
      if h.is_null() {
        return Err("mpv oluşturulamadı".into());
      }
      let m = Mpv { api, h };
      for (k, v) in options {
        let (k, v) = (CString::new(k.as_str()).unwrap(), CString::new(v.as_str()).unwrap());
        (api.set_option_string)(h, k.as_ptr(), v.as_ptr());
      }
      let r = (api.initialize)(h);
      if r < 0 {
        return Err(format!("mpv başlatılamadı: {}", m.err(r)));
      }
      Ok(m)
    }
  }

  fn err(&self, code: c_int) -> String {
    unsafe { CStr::from_ptr((self.api.error_string)(code)).to_string_lossy().into_owned() }
  }

  /// A command as the JSON IPC takes it: ["seek", 10, "absolute"], ["get_property", "pause"],
  /// ["set_property", "pause", true]… Returns the command's result.
  pub fn command(&self, cmd: &[Value]) -> Result<Value, String> {
    let name = cmd.first().and_then(|v| v.as_str()).unwrap_or("");
    unsafe {
      match name {
        "get_property" => {
          let p = CString::new(cmd.get(1).and_then(|v| v.as_str()).unwrap_or("")).unwrap();
          let mut out = Node { u: NodeU { int64: 0 }, format: FMT_NONE };
          let r = (self.api.get_property)(self.h, p.as_ptr(), FMT_NODE, &mut out as *mut Node as *mut c_void);
          if r < 0 {
            return Err(self.err(r));
          }
          let v = to_json(&out);
          (self.api.free_node_contents)(&mut out);
          Ok(v)
        }
        "set_property" => {
          let p = CString::new(cmd.get(1).and_then(|v| v.as_str()).unwrap_or("")).unwrap();
          let mut arena = Arena::default();
          let mut n = arena.node(cmd.get(2).unwrap_or(&Value::Null));
          // "set" in the UI sends strings ("yes"/"no", numbers as text): mpv parses them like on the command line
          let r = (self.api.set_property)(self.h, p.as_ptr(), FMT_NODE, &mut n as *mut Node as *mut c_void);
          if r < 0 { Err(self.err(r)) } else { Ok(Value::Null) }
        }
        "observe_property" => {
          let id = cmd.get(1).and_then(|v| v.as_u64()).unwrap_or(0);
          let p = CString::new(cmd.get(2).and_then(|v| v.as_str()).unwrap_or("")).unwrap();
          let r = (self.api.observe_property)(self.h, id, p.as_ptr(), FMT_NODE);
          if r < 0 { Err(self.err(r)) } else { Ok(Value::Null) }
        }
        _ => {
          // numbers become strings for commands, as on mpv's command line ("seek 10 absolute")
          let args: Vec<Value> = cmd.iter().map(|v| match v {
            Value::String(_) => v.clone(),
            Value::Null => Value::String(String::new()),
            other => Value::String(other.to_string()),
          }).collect();
          let mut arena = Arena::default();
          let mut n = arena.node(&Value::Array(args));
          let mut out = Node { u: NodeU { int64: 0 }, format: FMT_NONE };
          let r = (self.api.command_node)(self.h, &mut n, &mut out);
          if r < 0 {
            return Err(self.err(r));
          }
          let v = to_json(&out);
          (self.api.free_node_contents)(&mut out);
          Ok(v)
        }
      }
    }
  }

  /// Next event (blocks up to `timeout` seconds). None when nothing happened.
  pub fn wait(&self, timeout: f64) -> Option<Ev> {
    unsafe {
      let e = &*(self.api.wait_event)(self.h, timeout);
      match e.event_id {
        0 => None,
        1 => Some(Ev::Shutdown),
        22 => {
          let p = &*(e.data as *const EventProperty);
          let name = CStr::from_ptr(p.name).to_string_lossy().into_owned();
          let v = if p.format == FMT_NODE && !p.data.is_null() { to_json(&*(p.data as *const Node)) } else { Value::Null };
          Some(Ev::Prop(name, v))
        }
        id => {
          let name = CStr::from_ptr((self.api.event_name)(id)).to_string_lossy().into_owned();
          let mut data = json!({ "event": name });
          if id == 7 && !e.data.is_null() {
            // end-file: reason and the error, named like the JSON IPC does
            let ef = &*(e.data as *const EventEndFile);
            let reason = match ef.reason { 0 => "eof", 2 => "stop", 3 => "quit", 4 => "error", 5 => "redirect", _ => "unknown" };
            data["reason"] = json!(reason);
            if ef.reason == 4 {
              data["file_error"] = json!(self.err(ef.error));
            }
          }
          Some(Ev::Event(name, data))
        }
      }
    }
  }

  pub fn wake(&self) {
    unsafe { (self.api.wakeup)(self.h) }
  }

  /// Stops playback and frees mpv (waits for it).
  pub fn destroy(&self) {
    unsafe { (self.api.terminate_destroy)(self.h) }
  }
}
