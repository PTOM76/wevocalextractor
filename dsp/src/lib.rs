//! WeVocalExtractor の推論の前後の処理（STFT と、マスクを掛けての逆STFT）。
//!
//! モデル（Spleeter 2stems）に合わせて n_fft 4096、hop 1024。512 フレームのブロック単位で処理し、
//! JS とのやりとりの回数を減らす。STFT そのものは wevocal-lib のものを使う。
//! wasm では素の C ABI（`ffi`）で公開し、Worker から `WebAssembly.instantiate` で読み込む。

mod ffi;
pub mod mdx;

use wevocal_lib::stft::Stft;

pub const N_FFT: usize = 4096;
pub const HOP: usize = 1024;
/// モデルが扱う周波数ビンの数（約 11kHz まで）
pub const MODEL_BINS: usize = 1024;
const EPS: f32 = 1e-10;

pub fn new_stft() -> Stft {
    Stft::new(N_FFT, HOP)
}

/// `x` の `frame0` から `count` フレームを変換する。
/// 複素スペクトルを `re` / `im`（[count][bins]）に、モデルへの入力（振幅、[count][MODEL_BINS]）を `mag` に入れる
pub fn analyze(st: &mut Stft, x: &[f32], frame0: usize, count: usize, re: &mut [f32], im: &mut [f32], mag: &mut [f32]) {
    let b = st.bins();
    for f in 0..count {
        let (r, i) = (&mut re[f * b..(f + 1) * b], &mut im[f * b..(f + 1) * b]);
        st.forward(x, frame0 + f, r, i);
        for (k, m) in mag[f * MODEL_BINS..(f + 1) * MODEL_BINS].iter_mut().enumerate() {
            *m = (r[k] * r[k] + i[k] * i[k]).sqrt();
        }
    }
}

/// 取り出す音のモデル出力 `mine` と、もう一方の `other`（どちらも [count][MODEL_BINS]）から比率のマスクを作り、
/// `re` / `im` に掛けて逆変換し、`out` に足し込む。`edge` なら 1024 ビンより上も 1024 ビン目のマスクで延ばす（偽なら 0）。
/// `wsum` があれば窓の2乗を足す（1チャンネル分だけ渡せばよい）
#[allow(clippy::too_many_arguments)]
pub fn synthesize(
    st: &mut Stft,
    re: &[f32],
    im: &[f32],
    mine: &[f32],
    other: &[f32],
    frame0: usize,
    count: usize,
    edge: bool,
    out: &mut [f32],
    mut wsum: Option<&mut [f32]>,
) {
    let b = st.bins();
    let mut r = vec![0.0f32; b];
    let mut i = vec![0.0f32; b];
    for f in 0..count {
        let o = f * MODEL_BINS;
        for k in 0..b {
            let mask = if k < MODEL_BINS || edge {
                let kk = k.min(MODEL_BINS - 1);
                let m = mine[o + kk] * mine[o + kk];
                (m + EPS / 2.0) / (m + other[o + kk] * other[o + kk] + EPS)
            } else {
                0.0
            };
            r[k] = re[f * b + k] * mask;
            i[k] = im[f * b + k] * mask;
        }
        st.inverse_add(&r, &i, frame0 + f, out, wsum.as_deref_mut());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// マスクが 1（伴奏の推定が 0）なら、元の音に戻る
    #[test]
    fn identity_mask_reconstructs() {
        let n = N_FFT * 4 + 1234;
        let x: Vec<f32> = (0..n).map(|i| (i as f32 * 0.031).sin() * 0.5).collect();
        let mut st = new_stft();
        let b = st.bins();
        let frames = (n - N_FFT) / HOP + 1;
        let (mut re, mut im) = (vec![0.0; frames * b], vec![0.0; frames * b]);
        let mut mag = vec![0.0; frames * MODEL_BINS];
        analyze(&mut st, &x, 0, frames, &mut re, &mut im, &mut mag);
        let zero = vec![0.0; frames * MODEL_BINS];
        let mut y = vec![0.0; n];
        let mut w = vec![0.0; n];
        synthesize(&mut st, &re, &im, &mag, &zero, 0, frames, true, &mut y, Some(&mut w));
        let err = (N_FFT..n - N_FFT).map(|i| (y[i] / w[i] - x[i]).abs()).fold(0.0f32, f32::max);
        assert!(err < 1e-4, "最大誤差 {err}");
    }

    /// edge でなければ、1024 ビンより上は消える
    #[test]
    fn zeros_above_model_bins() {
        let mut st = new_stft();
        let b = st.bins();
        // 周波数ごとに値が変わるスペクトル（全ビン 1 だと時刻 0 のインパルスになり、窓の先頭 0 で消えてしまう）
        let re: Vec<f32> = (0..b).map(|k| (k as f32 * 0.37).cos()).collect();
        let im: Vec<f32> = (0..b).map(|k| (k as f32 * 0.61).sin()).collect();
        let ones = vec![1.0; MODEL_BINS];
        let zero = vec![0.0; MODEL_BINS];
        let mut a = vec![0.0; N_FFT];
        let mut c = vec![0.0; N_FFT];
        synthesize(&mut st, &re, &im, &ones, &zero, 0, 1, false, &mut a, None);
        synthesize(&mut st, &re, &im, &ones, &zero, 0, 1, true, &mut c, None);
        assert!(a.iter().zip(&c).any(|(p, q)| (p - q).abs() > 1e-3));
    }
}
