import type { LicenseEntry } from 'pevenmui'
import { t } from './i18n'

/**
 * ヘルプの「ライセンス情報」に出す、使っている部品・モデルの一覧。ライセンスの扱いの詳しいことは LICENSE-THIRD-PARTY.md。
 * 部品を足したら、ここにも足す
 */
export const licenseEntries = (repository: string): LicenseEntry[] => [
  { name: 'WeVocalExtractor', license: 'MIT', url: repository, note: t('licenses.app') },
  { name: 'PevenMUI', license: 'MIT', url: 'https://github.com/PTOM76/pevenmui', note: t('licenses.ui') },
  { name: 'WeVocalLib', license: 'MIT', url: 'https://github.com/PTOM76/wevocal-lib', note: t('licenses.audio') },
  { name: 'React', license: 'MIT', url: 'https://github.com/facebook/react', note: t('licenses.ui') },
  { name: 'MUI (Material UI)', license: 'MIT', url: 'https://github.com/mui/material-ui', note: t('licenses.ui') },
  { name: 'Emotion', license: 'MIT', url: 'https://github.com/emotion-js/emotion', note: t('licenses.style') },
  { name: 'Font Awesome Free', license: 'CC BY 4.0 / MIT', url: 'https://fontawesome.com/license/free', note: t('licenses.icons') },
  { name: 'Roboto', license: 'OFL-1.1', url: 'https://fontsource.org/fonts/roboto', note: t('licenses.font') },
  { name: 'lamejs', license: 'LGPL-3.0', url: 'https://github.com/nicktindall/lamejs', note: t('licenses.mp3') },
  { name: 'Workbox', license: 'MIT', url: 'https://github.com/GoogleChrome/workbox', note: t('licenses.pwa') },
  { name: 'ONNX Runtime Web', license: 'MIT', url: 'https://github.com/microsoft/onnxruntime', note: t('licenses.ort') },
  { name: 'Spleeter', license: 'MIT', url: 'https://github.com/deezer/spleeter', note: t('licenses.spleeter') },
  { name: 'Ultimate Vocal Remover (UVR)', license: 'MIT', url: 'https://github.com/Anjok07/ultimatevocalremovergui', note: t('licenses.uvr') },
  { name: 'sherpa-onnx', license: 'Apache-2.0', url: 'https://github.com/k2-fsa/sherpa-onnx', note: t('licenses.sherpa') },
]
