import { useEffect, useRef, useState } from 'react'
import { Box, Button, IconButton, LinearProgress, Paper, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDownload, faPlay, faRotateRight, faStop, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useT } from './i18n'
import type { QueueItem } from './useQueue'

export type Stem = 'vocals' | 'accompaniment'

/** 一覧で鳴らしている音（1つだけ） */
function usePreviewPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const stop = () => {
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    audioRef.current = null
    urlRef.current = null
    setPlaying(null)
  }
  const toggle = (key: string, blob: Blob) => {
    const same = playing === key
    stop()
    if (same) return
    urlRef.current = URL.createObjectURL(blob)
    const a = new Audio(urlRef.current)
    a.onended = stop
    audioRef.current = a
    void a.play()
    setPlaying(key)
  }
  useEffect(() => stop, [])
  return { playing, toggle }
}

/** 取り出す曲の一覧。PC は1行に、スマホは折り返して2行にまとめる */
export function QueueList(p: {
  items: QueueItem[]
  busy: boolean
  onSave: (item: QueueItem, stem: Stem) => void
  onRetry: (id: number) => void
  onRemove: (id: number) => void
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
              {it.status === 'error' && (
                <Tooltip title={t('item.retry')}>
                  <IconButton size="small" disabled={p.busy} onClick={() => p.onRetry(it.id)}>
                    <FontAwesomeIcon icon={faRotateRight} fontSize={12} />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={t('item.remove')}>
                <span>
                  <IconButton size="small" disabled={it.status === 'running'} onClick={() => p.onRemove(it.id)}>
                    <FontAwesomeIcon icon={faXmark} fontSize={12} />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>
          {it.status === 'running' && <LinearProgress variant="determinate" value={it.progress * 100} sx={{ mt: 0.5 }} />}
        </Box>
      ))}
    </Paper>
  )
}
