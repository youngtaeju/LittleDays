import { useId, type ComponentProps } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export function NativeSelect({
  className,
  ...props
}: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base focus-visible:border-ring disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export function SelectField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & ComponentProps<'select'>) {
  const id = useId()
  const hintId = useId()
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        aria-describedby={hint ? hintId : undefined}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
