//! wasm 向けの C ABI。メモリは JS 側が `alloc_f32` で確保し、ポインタと長さを渡す。
//! wasm のメモリが増えると JS 側の Float32Array が無効になるので、確保が終わってから view を作ること。

use std::cell::RefCell;
use wevocal_lib::stft::Stft;

thread_local! {
    static STFT: RefCell<Stft> = RefCell::new(crate::new_stft());
    /// MDX-Net 用（n_fft はモデルごと。同じなら作り直さない）
    static MDX_STFT: RefCell<Option<(usize, usize, Stft)>> = const { RefCell::new(None) };
}

/// MDX-Net 用の STFT（`n_fft`・`hop` が変わったら作り直す）
fn with_mdx_stft<T>(n_fft: usize, hop: usize, f: impl FnOnce(&mut Stft) -> T) -> T {
    MDX_STFT.with(|s| {
        let mut s = s.borrow_mut();
        if !matches!(&*s, Some((n, h, _)) if *n == n_fft && *h == hop) {
            *s = Some((n_fft, hop, Stft::new(n_fft, hop)));
        }
        f(&mut s.as_mut().unwrap().2)
    })
}

#[no_mangle]
pub extern "C" fn alloc_f32(len: usize) -> *mut f32 {
    let mut v = vec![0.0f32; len];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` は `alloc_f32(len)` で確保したもの
#[no_mangle]
pub unsafe extern "C" fn free_f32(ptr: *mut f32, len: usize) {
    drop(Vec::from_raw_parts(ptr, len, len));
}

/// `crate::analyze` の C ABI 版
///
/// # Safety
/// 各ポインタは、指定した長さ（`re` / `im` は count × bins、`mag` は count × MODEL_BINS）の確保済みの領域
#[no_mangle]
pub unsafe extern "C" fn analyze_block(x: *const f32, x_len: usize, frame0: usize, count: usize, re: *mut f32, im: *mut f32, mag: *mut f32) {
    STFT.with(|st| {
        let mut st = st.borrow_mut();
        let b = st.bins();
        crate::analyze(
            &mut st,
            std::slice::from_raw_parts(x, x_len),
            frame0,
            count,
            std::slice::from_raw_parts_mut(re, count * b),
            std::slice::from_raw_parts_mut(im, count * b),
            std::slice::from_raw_parts_mut(mag, count * crate::MODEL_BINS),
        );
    })
}

/// `crate::synthesize` の C ABI 版。`wsum` は null なら足さない
///
/// # Safety
/// 各ポインタは確保済みの領域（`re` / `im` は count × bins、`mine` / `other` は count × MODEL_BINS、`out` / `wsum` は out_len）
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn synthesize_block(
    re: *const f32,
    im: *const f32,
    mine: *const f32,
    other: *const f32,
    frame0: usize,
    count: usize,
    edge: u32,
    out: *mut f32,
    out_len: usize,
    wsum: *mut f32,
) {
    STFT.with(|st| {
        let mut st = st.borrow_mut();
        let b = st.bins();
        let w = if wsum.is_null() { None } else { Some(std::slice::from_raw_parts_mut(wsum, out_len)) };
        crate::synthesize(
            &mut st,
            std::slice::from_raw_parts(re, count * b),
            std::slice::from_raw_parts(im, count * b),
            std::slice::from_raw_parts(mine, count * crate::MODEL_BINS),
            std::slice::from_raw_parts(other, count * crate::MODEL_BINS),
            frame0,
            count,
            edge != 0,
            std::slice::from_raw_parts_mut(out, out_len),
            w,
        );
    })
}

/// `crate::mdx::analyze` の C ABI 版。区間の長さは `hop × (dim_t − 1)`
///
/// # Safety
/// `l` / `r` は区間の長さ、`tensor` は 4 × dim_f × dim_t の確保済みの領域
#[no_mangle]
pub unsafe extern "C" fn mdx_analyze(l: *const f32, r: *const f32, n_fft: usize, hop: usize, dim_f: usize, dim_t: usize, tensor: *mut f32) {
    let len = crate::mdx::segment_len(hop, dim_t);
    with_mdx_stft(n_fft, hop, |st| {
        crate::mdx::analyze(
            st,
            std::slice::from_raw_parts(l, len),
            std::slice::from_raw_parts(r, len),
            dim_f,
            dim_t,
            std::slice::from_raw_parts_mut(tensor, 4 * dim_f * dim_t),
        )
    })
}

/// `crate::mdx::synthesize` の C ABI 版
///
/// # Safety
/// `tensor` は 4 × dim_f × dim_t、`l` / `r` は区間の長さの確保済みの領域
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn mdx_synthesize(tensor: *const f32, n_fft: usize, hop: usize, dim_f: usize, dim_t: usize, gain: f32, l: *mut f32, r: *mut f32) {
    let len = crate::mdx::segment_len(hop, dim_t);
    with_mdx_stft(n_fft, hop, |st| {
        crate::mdx::synthesize(
            st,
            std::slice::from_raw_parts(tensor, 4 * dim_f * dim_t),
            dim_f,
            dim_t,
            gain,
            std::slice::from_raw_parts_mut(l, len),
            std::slice::from_raw_parts_mut(r, len),
        )
    })
}
