//! `MatchSink` that rebuilds the text with every match replaced.

use regex::Captures;
use ropey::{Rope, RopeBuilder};

use crate::search::scan::{MatchSink, Window};

/// Streams the replaced text into a `RopeBuilder`.
///
/// The builder is created lazily at the first match: a rope without matches costs
/// nothing and the caller keeps (shares) the original. Unchanged text between
/// matches is appended straight from the scan window (`&str` slices, no
/// byte→char conversion); only the prefix before the very first match is copied
/// from the rope.
pub struct ReplaceSink<'a> {
    /// The rope being scanned (offsets are relative to it).
    rope: &'a Rope,
    replacement: &'a str,
    /// Expand `$1`, `${name}`, `$$` ... (regex mode with a `$` in the replacement).
    expand: bool,
    builder: Option<RopeBuilder>,
    /// Absolute offset up to which source text has been emitted into `builder`.
    copied_abs: usize,
    count: usize,
    scratch: String,
}

impl<'a> ReplaceSink<'a> {
    pub fn new(rope: &'a Rope, replacement: &'a str, expand: bool) -> Self {
        ReplaceSink {
            rope,
            replacement,
            expand,
            builder: None,
            copied_abs: 0,
            count: 0,
            scratch: String::new(),
        }
    }

    /// `Some((new rope, match count))`, or `None` when nothing matched.
    pub fn finish(self) -> Option<(Rope, usize)> {
        let count = self.count;
        self.builder.map(|b| (b.finish(), count))
    }
}

/// Append `rope[..upto_byte]` to `builder`.
fn append_rope_prefix(builder: &mut RopeBuilder, rope: &Rope, upto_byte: usize) {
    let upto_char = rope.byte_to_char(upto_byte);
    for chunk in rope.slice(..upto_char).chunks() {
        builder.append(chunk);
    }
}

impl MatchSink for ReplaceSink<'_> {
    fn on_match(&mut self, win: &Window, start: usize, end: usize, caps: Option<&Captures>) {
        let abs_start = win.abs_start + start;

        if self.builder.is_none() {
            let mut b = RopeBuilder::new();
            append_rope_prefix(&mut b, self.rope, abs_start);
            self.builder = Some(b);
        } else {
            debug_assert!(self.copied_abs >= win.abs_start && self.copied_abs <= abs_start);
            let from = self.copied_abs - win.abs_start;
            if from < start {
                self.builder.as_mut().unwrap().append(&win.text[from..start]);
            }
        }

        let builder = self.builder.as_mut().unwrap();
        match (self.expand, caps) {
            (true, Some(caps)) => {
                self.scratch.clear();
                caps.expand(self.replacement, &mut self.scratch);
                builder.append(&self.scratch);
            }
            _ => builder.append(self.replacement),
        }

        self.copied_abs = win.abs_start + end;
        self.count += 1;
    }

    fn flush(&mut self, win: &Window, upto: usize) {
        let Some(builder) = self.builder.as_mut() else {
            return;
        };
        debug_assert!(self.copied_abs >= win.abs_start);
        let from = self.copied_abs - win.abs_start;
        if from < upto {
            builder.append(&win.text[from..upto]);
            self.copied_abs = win.abs_start + upto;
        }
    }
}
