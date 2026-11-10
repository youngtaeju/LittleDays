import IconCheckCircle from '~icons/material-symbols/check-circle-outline-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-outline-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconWarning from '~icons/material-symbols/warning-outline-rounded'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// theme 은 호출 측이 useTheme 값을 전달.
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    className="toaster group"
    icons={{
      success: <IconCheckCircle className="size-4" />,
      info: <IconInfo className="size-4" />,
      warning: <IconWarning className="size-4" />,
      error: <IconError className="size-4" />,
      loading: <IconProgress className="size-4 animate-spin" />,
    }}
    style={
      {
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
      } as React.CSSProperties
    }
    {...props}
  />
)

export { Toaster }
