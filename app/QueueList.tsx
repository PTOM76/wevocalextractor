import { useEffect, useRef, useState } from 'react'
import { Box, Button, IconButton, LinearProgress, Paper, Slider, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDownload, faPlay, faStop, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useT } from './i18n'
import type { QueueItem } from './useQueue'

export type Stem = 'vocals' | 'accompaniment'

/** 一覧で鳴らしている音（1つだけ） */
function usePreviewPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  // 再生位置と長さ（秒）。行の下のスライダーに出す
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const stop = () => {
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    audioRef.current = null
    urlRef.current = null
    setPlaying(null)
    setTime(0)
    setDuration(0)
  }
  const toggle = (key: string, blob: Blob) => {
    const same = playing === key
    stop()
    if (same) return
    urlRef.current = URL.createObjectURL(blob)
    const a = new Audio(urlRef.current)
    a.onended = stop
    a.ontimeupdate = () => setTime(a.currentTime)
    a.onloadedmetadata = () => setDuration(a.duration)
    audioRef.current = a
    void a.play()
    setPlaying(key)
  }
  /** 再生位置を変える（秒） */
  const seek = (t: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = t
    setTime(t)
  }
  useEffect(() => stop, [])
  return { playing, time, duration, toggle, seek }
}

/** 秒を「分:秒」で表す */
const formatTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
/** 抽出する曲の一覧。PC は1行に、スマホは折り返して2行にまとめる */
export function QueueList(p: {
  items: QueueItem[]
  busy: boolean
  onSave: (item: QueueItem, stem: Stem) => void
  /** その曲だけ抽出する（待機中・失敗した曲） */
  onExtract: (id: number) => void
  onRemove: (id: number) => void
  /** 抽出中の曲だけを中止する */
  onCancel: (id: number) => void
}) {
  const t = useT()
  const player = usePreviewPlayer()
  const statusText = (it: QueueItem) =>
    it.status === 'running' ? t('status.running', { p: Math.round(it.progress * 100) }) : t(`status.${it.status}`)

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      {p.items.map((it, i) => (
        <Box key={it.id} sx={{ px: 2, py: 1, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 1.5, rowGap: 0.5, flexWrap: 'wrap' }}>
            <Typography className="selectable" sx={{ fontSize: 13, flex: '1 1 200px', minWidth: 0 }} noWrap title={it.file.name}>
              {it.file.name}
            </Typography>
            <Typography
              className={it.status === 'error' ? 'selectable' : undefined}
              title={it.error}
              sx={{ fontSize: 12, width: 120, color: it.status === 'error' ? 'error.main' : 'text.secondary' }}
              noWrap
            >
              {statusText(it)}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto' }}>
              {(['vocals', 'accompaniment'] as const).map((stem) => {
                const blob = it[stem]
                if (!blob) return null
                const key = `${it.id}-${stem}`
                const playing = player.playing === key
                return (
                  <Box key={stem} sx={{ display: 'flex', alignItems: 'center' }}>
                    <Tooltip title={playing ? t('item.stop') : t('item.play')}>
                      <IconButton size="small" onClick={() => player.toggle(key, blob)}>
                        <FontAwesomeIcon icon={playing ? faStop : faPlay} fontSize={12} />
                      </IconButton>
                    </Tooltip>
                    <Button size="small" startIcon={<FontAwesomeIcon icon={faDownload} fontSize={12} />} onClick={() => p.onSave(it, stem)}>
                      {t(`stem.${stem}`)}
                    </Button>
                  </Box>
                )
              })}
              {(it.status === 'waiting' || it.status === 'error' || it.status === 'cancelled') && (
                <Button size="small" variant="outlined" disabled={p.busy} onClick={() => p.onExtract(it.id)}>
                  {t('queue.extract')}
                </Button>
              )}
              {/* 抽出中の曲は、一覧から消す代わりにその曲だけ中止する */}
              <Tooltip title={t(it.status === 'running' ? 'item.cancel' : 'item.remove')}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={t(it.status === 'running' ? 'item.cancel' : 'item.remove')}
                    onClick={() => (it.status === 'running' ? p.onCancel(it.id) : p.onRemove(it.id))}
                  >
                    <FontAwesomeIcon icon={faXmark} fontSize={12} />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>
          {/* 試聴中の行には再生位置のスライダーを出す（ドラッグ・クリックで位置を変える） */}
          {player.playing?.startsWith(`${it.id}-`) && player.duration > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1 }}>
              <Slider
                size="small"
                min={0}
                max={player.duration}
                step={0.01}
                value={player.time}
                onChange={(_, v) => player.seek(v as number)}
                aria-label={t('item.position')}
              />
              <Typography sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(player.time)} / {formatTime(player.duration)}
              </Typography>
            </Box>
          )}
          {it.status === 'running' && <LinearProgress variant="determinate" value={it.progress * 100} sx={{ mt: 0.5 }} />}
        </Box>
      ))}
    </Paper>
  )
}
