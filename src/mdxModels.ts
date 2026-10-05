import type { MdxParams } from './types'

/**
 * UVR の MDX-Net のモデルごとの値（docs/MODELS.md の「UVR の MDX-Net」）。
 * dim_f・dim_t・hop は ONNX のメタデータ、n_fft・compensate・取り出す音は UVR の設定（model_data.json）から。
 * sherpa-onnx の ONNX のメタデータの n_fft は dim_f × 2 で、Voc_FT は UVR の設定（7680）と違うので、UVR の方を使う。
 * モデルを足したら、Synth の vocalExtract.ts・Extractor の app/models.ts と、ダウンロード元（scripts）にも足す
 */
export const MDX_MODELS = {
  /** ボーカルを取り出す。63MB */
  'voc-ft': { file: 'UVR-MDX-NET-Voc_FT.onnx', params: { nFft: 7680, dimF: 3072, dimT: 256, hop: 1024, compensate: 1.021, primary: 'vocals' } },
  /** 伴奏を取り出す。56MB */
  'inst-hq4': { file: 'UVR-MDX-NET-Inst_HQ_4.onnx', params: { nFft: 5120, dimF: 2560, dimT: 256, hop: 1024, compensate: 1.01, primary: 'accompaniment' } },
  /** 主旋律のボーカルを取り出す（和声は伴奏の側に残る）。モデルが出すのは主旋律以外。53MB */
  kara2: { file: 'UVR_MDXNET_KARA_2.onnx', params: { nFft: 5120, dimF: 2048, dimT: 256, hop: 1024, compensate: 1.065, primary: 'accompaniment' } },
} as const satisfies Record<string, { file: string; params: MdxParams }>

export type MdxModelId = keyof typeof MDX_MODELS

/** ダウンロード元（sherpa-onnx が ONNX にして配布しているもの） */
export const MDX_RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models'
