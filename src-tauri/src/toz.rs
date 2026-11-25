// Töz-Çevir (TozAI, Apache-2.0; fine-tuned on anime subtitles for Anisaki): a 74M-parameter English→Turkish
// model as 8-bit ONNX, run with ONNX Runtime on the CPU. The SentencePiece tokenizer is read directly
// (Unigram/Viterbi with byte fallback), the same as the old TypeScript runner, checked against Python.
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use std::collections::HashMap;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

/* ------------------------------ SentencePiece ------------------------------ */
struct Piece {
  piece: String,
  score: f32,
  kind: u64,
}
const NORMAL: u64 = 1;
const UNKNOWN: u64 = 2;
const CONTROL: u64 = 3;
const USER: u64 = 4;
const BYTE: u64 = 6;

fn read_pieces(buf: &[u8]) -> Vec<Piece> {
  let mut i = 0usize;
  let varint = |i: &mut usize| -> u64 {
    let (mut r, mut shift) = (0u64, 0u32);
    loop {
      let b = buf[*i];
      *i += 1;
      r |= ((b & 0x7f) as u64) << shift;
      if b < 0x80 {
        return r;
      }
      shift += 7;
    }
  };
  let skip = |i: &mut usize, wt: u64| match wt {
    0 => {
      varint(i);
    }
    1 => *i += 8,
    2 => {
      let n = varint(i) as usize;
      *i += n;
    }
    5 => *i += 4,
    _ => {}
  };
  let mut out = Vec::new();
  while i < buf.len() {
    let tag = varint(&mut i);
    let (field, wt) = (tag >> 3, tag & 7);
    if field != 1 || wt != 2 {
      skip(&mut i, wt);
      continue;
    }
    let len = varint(&mut i) as usize;
    let end = i + len;
    let mut p = Piece { piece: String::new(), score: 0.0, kind: 1 };
    while i < end {
      let t = varint(&mut i);
      let (f, w) = (t >> 3, t & 7);
      if f == 1 && w == 2 {
        let n = varint(&mut i) as usize;
        p.piece = String::from_utf8_lossy(&buf[i..i + n]).into_owned();
        i += n;
      } else if f == 2 && w == 5 {
        p.score = f32::from_le_bytes([buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]);
        i += 4;
      } else if f == 3 && w == 0 {
        p.kind = varint(&mut i);
      } else {
        skip(&mut i, w);
      }
    }
    i = end;
    out.push(p);
  }
  out
}

pub struct SentencePiece {
  pieces: Vec<Piece>,
  ids: HashMap<String, usize>,
  bytes: HashMap<u8, usize>,
  min_score: f32,
  unk: usize,
}

impl SentencePiece {
  fn load(file: &Path) -> Result<Self, String> {
    let pieces = read_pieces(&std::fs::read(file).map_err(|e| e.to_string())?);
    let (mut ids, mut bytes, mut min_score, mut unk) = (HashMap::new(), HashMap::new(), 0f32, 0usize);
    for (id, p) in pieces.iter().enumerate() {
      if p.kind == NORMAL || p.kind == USER {
        ids.insert(p.piece.clone(), id);
      }
      if p.kind == UNKNOWN {
        unk = id;
      }
      if p.kind == BYTE {
        if let Ok(b) = u8::from_str_radix(&p.piece[3..5], 16) {
          bytes.insert(b, id);
        }
      }
      if p.kind == NORMAL {
        min_score = min_score.min(p.score);
      }
    }
    Ok(SentencePiece { pieces, ids, bytes, min_score, unk })
  }

  fn id(&self, piece: &str) -> usize {
    *self.ids.get(piece).unwrap_or(&self.unk)
  }

  /// nmt_nfkc, extra whitespace removed, "▁" for spaces and in front (SentencePiece's defaults).
  fn normalize(s: &str) -> String {
    let t: String = s
      .nfkc()
      .filter(|c| !matches!(*c as u32, 0x00..=0x08 | 0x0B | 0x0E..=0x1F | 0x7F | 0x8F | 0x9F))
      .map(|c| match c as u32 {
        0x09 | 0x0a | 0x0d | 0x0c | 0x85 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff => ' ',
        _ => c,
      })
      .collect();
    let t = t.split(' ').filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
    if t.is_empty() { String::new() } else { format!("▁{}", t.replace(' ', "▁")) }
  }

  pub fn encode(&self, text: &str) -> Vec<i64> {
    let chars: Vec<char> = Self::normalize(text).chars().collect();
    let n = chars.len();
    if n == 0 {
      return vec![];
    }
    let mut best = vec![f64::NEG_INFINITY; n + 1];
    let mut back = vec![0usize; n + 1];
    let mut back_id = vec![-1i64; n + 1];
    best[0] = 0.0;
    let unk_score = (self.min_score - 10.0) as f64;
    for i in 0..n {
      if best[i] == f64::NEG_INFINITY {
        continue;
      }
      let mut s = String::new();
      let mut matched = false;
      for len in 1..=16 {
        if i + len > n {
          break;
        }
        s.push(chars[i + len - 1]);
        let Some(&id) = self.ids.get(&s) else { continue };
        let p = &self.pieces[id];
        let sc = best[i] + if p.kind == USER { 0.0 } else { p.score as f64 };
        if len == 1 {
          matched = true;
        }
        if sc > best[i + len] {
          best[i + len] = sc;
          back[i + len] = i;
          back_id[i + len] = id as i64;
        }
      }
      if !matched && best[i] + unk_score > best[i + 1] {
        best[i + 1] = best[i] + unk_score;
        back[i + 1] = i;
        back_id[i + 1] = -1;
      }
    }
    let mut out = Vec::new();
    let mut i = n;
    while i > 0 {
      let id = back_id[i];
      if id >= 0 {
        out.push(id);
      } else {
        let s: String = chars[back[i]..i].iter().collect();
        for b in s.as_bytes().iter().rev() {
          out.push(*self.bytes.get(b).unwrap_or(&self.unk) as i64);
        }
      }
      i = back[i];
    }
    out.reverse();
    out
  }

  pub fn decode(&self, ids: &[i64]) -> String {
    let mut bytes = Vec::new();
    for &id in ids {
      let Some(p) = self.pieces.get(id as usize) else { continue };
      match p.kind {
        CONTROL | USER => {}
        BYTE => {
          if let Ok(b) = u8::from_str_radix(&p.piece[3..5], 16) {
            bytes.push(b)
          }
        }
        UNKNOWN => bytes.extend_from_slice(" ⁇ ".as_bytes()),
        _ => bytes.extend_from_slice(p.piece.as_bytes()),
      }
    }
    String::from_utf8_lossy(&bytes).replace('▁', " ").trim().to_string()
  }
}

/* ---------------------------------- model ---------------------------------- */
const BOS: i64 = 2;
const EOS: i64 = 3;
const PAD: usize = 0;

/// The decoder cache; empty at the first step (ONNX Runtime only builds an empty tensor through an allocator).
fn past(p: &(Vec<usize>, Vec<f32>)) -> ort::Result<Tensor<f32>> {
  if p.1.is_empty() {
    Tensor::<f32>::new(&ort::memory::Allocator::default(), p.0.clone())
  } else {
    Tensor::from_array((p.0.clone(), p.1.clone()))
  }
}

pub struct Toz {
  enc: Session,
  dec: Session,
  sp: SentencePiece,
}

impl Toz {
  pub fn load(dir: &Path, threads: usize) -> Result<Toz, String> {
    let mk = |f: &str| -> Result<Session, String> {
      Session::builder()
        .and_then(|b| b.with_optimization_level(GraphOptimizationLevel::Level3))
        .and_then(|b| b.with_intra_threads(threads))
        .and_then(|b| b.with_inter_threads(1))
        .and_then(|b| b.with_memory_pattern(false))
        .and_then(|b| b.commit_from_file(dir.join("onnx").join(f)))
        .map_err(|e| format!("Çeviri modeli yüklenemedi: {e}"))
    };
    Ok(Toz { enc: mk("encoder_q8.onnx")?, dec: mk("decoder_q8.onnx")?, sp: SentencePiece::load(&dir.join("tokenizer.model"))? })
  }

  /// One sentence (optionally with the previous line as context), beam search with 4 beams.
  pub fn sentence(&mut self, text: &str, beam: usize) -> Result<String, String> {
    let e = |x: ort::Error| x.to_string();
    let mut ids = self.sp.encode(text);
    ids.truncate(254);
    if ids.is_empty() {
      return Ok(String::new());
    }
    let mut src = vec![self.sp.id("<2tr>") as i64];
    src.extend(&ids);
    src.push(EOS);
    let n = src.len();
    let out = self.enc.run(ort::inputs!["src" => Tensor::from_array(([1usize, n], src)).map_err(e)?]).map_err(e)?;
    let (ckshape, ckdata) = out["cross_k"].try_extract_tensor::<f32>().map_err(e)?;
    let (cvshape, cvdata) = out["cross_v"].try_extract_tensor::<f32>().map_err(e)?;
    let ckshape: Vec<usize> = ckshape.iter().map(|&d| d as usize).collect();
    let cvshape: Vec<usize> = cvshape.iter().map(|&d| d as usize).collect();
    let (ckdata, cvdata) = (ckdata.to_vec(), cvdata.to_vec());
    drop(out);
    let mut pk: (Vec<usize>, Vec<f32>) = (vec![6, 1, 8, 0, 64], vec![]);
    let mut pv = pk.clone();
    let mut hyps: Vec<Vec<i64>> = vec![vec![]];
    let mut score = vec![0f64];
    let mut last = vec![BOS];
    let mut bidx = vec![0i64];
    let mut done: Vec<(f64, Vec<i64>)> = Vec::new();
    let max_steps = (2 * ids.len() + 10).min(254);
    for pos in 0..max_steps {
      let b = last.len();
      let r = self
        .dec
        .run(ort::inputs![
          "token" => Tensor::from_array(([b, 1usize], last.clone())).map_err(e)?,
          "pos" => Tensor::from_array(([1usize], vec![pos as i64])).map_err(e)?,
          "past_k" => past(&pk).map_err(e)?,
          "past_v" => past(&pv).map_err(e)?,
          "beam_idx" => Tensor::from_array(([b], bidx.clone())).map_err(e)?,
          "cross_k" => Tensor::from_array((ckshape.clone(), ckdata.clone())).map_err(e)?,
          "cross_v" => Tensor::from_array((cvshape.clone(), cvdata.clone())).map_err(e)?
        ])
        .map_err(e)?;
      let (ks, kd) = r["new_k"].try_extract_tensor::<f32>().map_err(e)?;
      pk = (ks.iter().map(|&d| d as usize).collect(), kd.to_vec());
      let (vs, vd) = r["new_v"].try_extract_tensor::<f32>().map_err(e)?;
      pv = (vs.iter().map(|&d| d as usize).collect(), vd.to_vec());
      let (ls, logits) = r["logits"].try_extract_tensor::<f32>().map_err(e)?;
      let v = ls[1] as usize;
      // log-softmax per row, then the best 2×beam continuations over all rows
      let mut cand: Vec<(f64, usize, usize)> = Vec::new();
      for (bi, h) in hyps.iter().enumerate() {
        let _ = h;
        let row = &logits[bi * v..(bi + 1) * v];
        let max = row.iter().cloned().fold(f32::NEG_INFINITY, f32::max) as f64;
        let sum: f64 = row.iter().map(|&x| ((x as f64) - max).exp()).sum();
        let lse = max + sum.ln();
        let mut top: Vec<(f64, usize)> = Vec::with_capacity(2 * beam + 1);
        for (k, &x) in row.iter().enumerate() {
          if k == PAD {
            continue;
          }
          let s = score[bi] + x as f64 - lse;
          if top.len() < 2 * beam || s > top[top.len() - 1].0 {
            if top.len() == 2 * beam {
              top.pop();
            }
            let at = top.partition_point(|t| t.0 >= s);
            top.insert(at, (s, k));
          }
        }
        for (s, k) in top {
          cand.push((s, bi, k));
        }
      }
      cand.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
      let (mut nh, mut ns, mut nb, mut nl) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
      for &(s, bi, t) in cand.iter().take(2 * beam) {
        if t as i64 == EOS {
          done.push((s / (hyps[bi].len() + 1) as f64, hyps[bi].clone()));
        } else if nh.len() < beam {
          let mut h = hyps[bi].clone();
          h.push(t as i64);
          nh.push(h);
          ns.push(s);
          nb.push(bi as i64);
          nl.push(t as i64);
        }
      }
      if nh.is_empty() || done.len() >= beam {
        break;
      }
      hyps = nh;
      score = ns;
      bidx = nb;
      last = nl;
    }
    let best = done.into_iter().max_by(|a, b| a.0.partial_cmp(&b.0).unwrap()).map(|d| d.1).unwrap_or_else(|| hyps[0].clone());
    Ok(self.sp.decode(&best))
  }
}
