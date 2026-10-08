import type { DemucsParams } from './types'

/**
 * Demucs v4（htdemucs、Meta。MIT）の ONNX 版（docs/MODELS.md の「Demucs」）。重みを fp16 で持つ版を使う
 * （fp32 版と出力の差は最大 4.6e-5。実行時は fp32 で計算するので、メモリと速さは同じ）。
 * モデルを足したら、Synth の vocalExtract.ts と、ダウンロード元（scripts）にも足す
 */
export const DEMUCS_MODELS = {
  /** ドラム、ベース、その他、ボーカルの 4 つに分ける。166MB */
  htdemucs: { url: 'https://huggingface.co/adowu/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx', params: { sources: ['drums', 'bass', 'other', 'vocals'] } },
  /** 4 つ + ギター、ピアノの 6 つに分ける。136MB */
  htdemucs6s: {
    url: 'https://huggingface.co/adowu/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx',
    params: { sources: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] },
  },
} as const satisfies Record<string, { url: string; params: DemucsParams }>

export type DemucsModelId = keyof typeof DEMUCS_MODELS
