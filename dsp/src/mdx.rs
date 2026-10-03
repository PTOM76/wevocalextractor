//! UVR の MDX-Net 用の、推論の前後の処理（docs/MODELS.md の「UVR の MDX-Net」）。
//!
//! 区間（`hop × (dim_t − 1)` サンプル）ごとに、両端を折り返して `n_fft / 2` ずつ延ばしてから STFT を取り（torch の center=True と同じ）、
//! モデルの入力 `[4][dim_f][dim_t]`（左の実部・左の虚部・右の実部・右の虚部）に並べる。
//! モデルの出力も同じ並びの複素スペクトログラムで、dim_f より上のビンは 0 として逆変換し、窓の 2 乗の和で割って両端を落とす。

use wevocal_lib::stft::Stft;

/// 区間の長さ（サンプル）
pub fn segment_len(hop: usize, dim_t: usize) -> usize {
    hop * (dim_t - 1)
}

/// `x`（長さ `len`）の両端を `pad` ずつ折り返して延ばす（端そのものは繰り返さない。torch の reflect と同じ）
fn reflect_pad(x: &[f32], pad: usize) -> Vec<f32> {
    let n = x.len();
    let at = |i: isize| -> f32 {
        let mut i = i;
        // 区間より短い延ばし方なら 1 回の折り返しで収まる。念のため収まるまで折り返す
        while i < 0 || i >= n as isize {
            i = if i < 0 { -i } else { 2 * (n as isize - 1) - i };
        }
        x[i as usize]
    };
    (0..n + 2 * pad).map(|i| at(i as isize - pad as isize)).collect()
}

/// 区間の左右 `l` / `r` から、モデルの入力 `tensor`（4 × dim_f × dim_t）を作る
pub fn analyze(st: &mut Stft, l: &[f32], r: &[f32], dim_f: usize, dim_t: usize, tensor: &mut [f32]) {
    let n_fft = st.window().len();
    let b = st.bins();
    let (mut re, mut im) = (vec![0.0f32; b], vec![0.0f32; b]);
    for (c, x) in [l, r].into_iter().enumerate() {
        let padded = reflect_pad(x, n_fft / 2);
        for t in 0..dim_t {
            st.forward(&padded, t, &mut re, &mut im);
            for f in 0..dim_f {
                tensor[((c * 2) * dim_f + f) * dim_t + t] = re[f];
                tensor[((c * 2 + 1) * dim_f + f) * dim_t + t] = im[f];
            }
        }
    }
}

/// モデルの出力 `tensor`（4 × dim_f × dim_t）を逆変換し、区間の左右 `l` / `r`（長さ `segment_len`）に入れる。`gain` を掛ける
pub fn synthesize(st: &mut Stft, tensor: &[f32], dim_f: usize, dim_t: usize, gain: f32, l: &mut [f32], r: &mut [f32]) {
    let n_fft = st.window().len();
    let b = st.bins();
    let len = l.len();
    let full = len + n_fft;
    let (mut re, mut im) = (vec![0.0f32; b], vec![0.0f32; b]);
    let mut wsum = vec![0.0f32; full];
    for (c, out) in [l, r].into_iter().enumerate() {
        let mut y = vec![0.0f32; full];
        for t in 0..dim_t {
            re.fill(0.0);
            im.fill(0.0);
            for f in 0..dim_f.min(b) {
                re[f] = tensor[((c * 2) * dim_f + f) * dim_t + t];
                im[f] = tensor[((c * 2 + 1) * dim_f + f) * dim_t + t];
            }
            // 窓の 2 乗の和は 1 チャンネル目のときだけ足す（どちらも同じ）
            st.inverse_add(&re, &im, t, &mut y, if c == 0 { Some(&mut wsum) } else { None });
        }
        let half = n_fft / 2;
        for (i, o) in out.iter_mut().enumerate() {
            let w = wsum[i + half];
            *o = if w > 1e-8 { y[i + half] / w * gain } else { 0.0 };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 入力をそのまま出力として返すと（取り出した音 = 元の音）、元に戻る（n_fft が 2 のべき乗でなくても）
    #[test]
    fn identity_round_trip() {
        for (n_fft, dim_f) in [(7680usize, 3072usize), (5120, 2560)] {
            let (hop, dim_t) = (1024, 32);
            let len = segment_len(hop, dim_t);
            // 高い周波数を含まない音（dim_f より上は 0 にするので）
            let l: Vec<f32> = (0..len).map(|i| (i as f32 * 0.02).sin() * 0.5).collect();
            let r: Vec<f32> = (0..len).map(|i| (i as f32 * 0.035).cos() * 0.3).collect();
            let mut st = Stft::new(n_fft, hop);
            let mut tensor = vec![0.0f32; 4 * dim_f * dim_t];
            analyze(&mut st, &l, &r, dim_f, dim_t, &mut tensor);
            let (mut ol, mut or) = (vec![0.0f32; len], vec![0.0f32; len]);
            synthesize(&mut st, &tensor, dim_f, dim_t, 1.0, &mut ol, &mut or);
            let err = ol.iter().zip(&l).chain(or.iter().zip(&r)).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
            // 7680 点の FFT を f32 で計算するので、丸めの誤差が 0.001 ほど出る（-60dB。聞こえない）
            assert!(err < 3e-3, "n_fft {n_fft}: {err}");
        }
    }

    #[test]
    fn reflect() {
        assert_eq!(reflect_pad(&[1.0, 2.0, 3.0, 4.0], 2), vec![3.0, 2.0, 1.0, 2.0, 3.0, 4.0, 3.0, 2.0]);
    }
}
