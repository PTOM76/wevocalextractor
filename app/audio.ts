// 音声ファイルの読み込みと WAV の書き出し。
// WeVocalSynth の src/audio/decode.ts・wav.ts を簡単にしたもの（いずれ wevocal-lib の TypeScript 側にまとめる）

export interface Clip {
  sampleRate: number
  channels: Float32Array[]
}

/** 読み込める形式（ファイル選択ダイアログ用） */
export const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.mp4,video/mp4'

/** WAV ならヘッダからサンプルレートを読む（読み込み時のリサンプルを避ける） */
function wavSampleRate(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 28) return null
  const v = new DataView(buf)
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let o = 12
  while (o + 8 <= buf.byteLength) {
    const size = v.getUint32(o + 4, true)
    if (tag(o) === 'fmt ' && o + 16 <= buf.byteLength) return v.getUint32(o + 12, true)
    o += 8 + size + (size % 2)
  }
  return null
}

/** 音声ファイルをブラウザ内でデコードする。WAV 以外は 44.1kHz（モデルと同じ）でデコードする */
export async function decodeFile(file: File): Promise<Clip> {
  const data = await file.arrayBuffer()
  const rate = Math.min(Math.max(wavSampleRate(data) ?? 44100, 8000), 384000)
  const audio = await new OfflineAudioContext(1, 1, rate).decodeAudioData(data)
  return {
    sampleRate: audio.sampleRate,
    channels: Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i).slice()),
  }
}

/** 16bit の WAV にする */
export function encodeWav(clip: Clip): Blob {
  const ch = clip.channels.length
  const frames = clip.channels[0]?.length ?? 0
  const dataSize = frames * ch * 2
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + dataSize, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, ch, true)
  v.setUint32(24, clip.sampleRate, true)
  v.setUint32(28, clip.sampleRate * ch * 2, true)
  v.setUint16(32, ch * 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, dataSize, true)
  let o = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, clip.channels[c][i]))
      v.setInt16(o, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), true)
      o += 2
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** Blob をファイルとしてダウンロードさせる */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
