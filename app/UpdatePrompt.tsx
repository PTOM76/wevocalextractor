import { Alert, Button, IconButton, Snackbar } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { t } from './i18n'

/** 開いたままでも新しい版に気づけるよう、更新を確認する間隔（ミリ秒） */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * 新しい版が公開されたときの通知。勝手に入れ替えると抽出中に再読み込みされるため、
 * 利用者が「更新」を押したときだけ切り替える（WeVocalSynth の UpdatePrompt と同じ）
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => void registration.update().catch(() => {})
      setInterval(check, CHECK_INTERVAL_MS)
      // ホーム画面の PWA は開き直しても読み込み直さないことが多いので、画面に戻ってきたときにも確認する
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })

  return (
    <Snackbar open={needRefresh} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
      <Alert
        severity="info"
        variant="filled"
        action={
          <>
            <Button color="inherit" size="small" onClick={() => void updateServiceWorker(true)}>
              {t('updateReload')}
            </Button>
            <IconButton color="inherit" size="small" aria-label={t('close')} title={t('close')} onClick={() => setNeedRefresh(false)}>
              <FontAwesomeIcon icon={faXmark} />
            </IconButton>
          </>
        }
      >
        {t('updateAvailable')}
      </Alert>
    </Snackbar>
  )
}
