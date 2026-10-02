import type { QueueItem } from './useQueue'

// 一覧を IndexedDB に残し、ページを閉じても次に開いたときに戻す。
// - 待機中・失敗した曲は、元のファイルごと残す（開き直したら続きから抽出できる）。抽出中の曲は待機中として残す
// - 抽出した結果は、まだダウンロードしていないものだけ残す。ダウンロードしても画面の一覧からは消さない（次に開いたときに出ないだけ）
// - ボーカル・伴奏ともダウンロードした曲は残さない
// どこまで残すかは設定で変えられる（`KeepMode`。残さない・ダウンロードした結果も残す）

const DB = 'wevocalextractor'
const STORE = 'queue'

/** IndexedDB に入れる1曲 */
interface StoredItem {
  id: number
  file: File
  status: 'waiting' | 'done' | 'error'
  ext?: string
  error?: string
  vocals?: Blob
  accompaniment?: Blob
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 1回の読み書き（`fn` でストアを操作し、終わったら閉じる） */
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      t.oncomplete = () => resolve(req ? req.result : undefined)
      t.onerror = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}

/** 一覧をどこまで残すか（設定）。none: 残さない、undownloaded: ダウンロードしていない結果だけ、all: ダウンロードした結果も */
export type KeepMode = 'none' | 'undownloaded' | 'all'

/** 残すもの（残す必要がなければ null）。抽出中の進み具合は残さない */
export function toStored(it: QueueItem, mode: KeepMode): StoredItem | null {
  if (mode === 'none') return null
  const keepSaved = mode === 'all'
  const vocals = it.saved?.vocals && !keepSaved ? undefined : it.vocals
  const accompaniment = it.saved?.accompaniment && !keepSaved ? undefined : it.accompaniment
  if (it.status === 'done') {
    // 結果がすべてダウンロード済み（または結果がない）なら残さない
    if (!vocals && !accompaniment) return null
    return { id: it.id, file: it.file, status: 'done', ext: it.ext, vocals, accompaniment }
  }
  return { id: it.id, file: it.file, status: it.status === 'error' ? 'error' : 'waiting', error: it.error }
}

/** 残したものが変わったかを見分けるための文字列（変わったときだけ書き込む） */
export function signature(s: StoredItem | null) {
  return s ? `${s.status}|${s.ext ?? ''}|${s.error ?? ''}|${s.vocals ? 1 : 0}|${s.accompaniment ? 1 : 0}` : ''
}

/** 前回残した一覧を読む。読めなければ空 */
export async function loadQueue(): Promise<QueueItem[]> {
  try {
    const rows = (await tx<StoredItem[]>('readonly', (s) => s.getAll() as IDBRequest<StoredItem[]>)) ?? []
    return rows
      .sort((a, b) => a.id - b.id)
      .map((r): QueueItem => ({ id: r.id, file: r.file, status: r.status, progress: r.status === 'done' ? 1 : 0, ext: r.ext, error: r.error, vocals: r.vocals, accompaniment: r.accompaniment }))
  } catch {
    return []
  }
}

/** 1曲を書き込む（`null` なら消す） */
export async function putItem(id: number, s: StoredItem | null) {
  try {
    await tx('readwrite', (store) => {
      if (s) store.put(s)
      else store.delete(id)
    })
  } catch {
    // 残せなくても（容量不足・プライベートモードなど）、このページでは使い続けられる
  }
}

/** 保存した一覧をすべて消す（設定の「データ」から） */
export async function clearQueue() {
  try {
    await tx('readwrite', (s) => s.clear())
  } catch {
    // 消せなくても続ける
  }
}
