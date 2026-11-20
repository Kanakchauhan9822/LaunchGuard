import { useRef } from "react"

export default function PanelDivider({ label, controls, share, onResize }) {
  const dragOffset = useRef(0)

  function resizeList(value) {
    onResize(Math.max(25, Math.min(70, Math.round(value))))
  }

  return (
    <div
      className="findings-grip"
      role="separator"
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuemin={25}
      aria-valuemax={70}
      aria-valuenow={share}
      aria-valuetext={share + '%'}
      tabIndex={0}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return
        const grip = event.currentTarget
        dragOffset.current = event.clientX - grip.getBoundingClientRect().left
        grip.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        const grip = event.currentTarget
        if (!grip.hasPointerCapture(event.pointerId)) return
        const bounds = grip.parentElement.getBoundingClientRect()
        const width = event.clientX - bounds.left - dragOffset.current
        resizeList(100 * width / (bounds.width - grip.offsetWidth))
      }}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          resizeList(share + (event.key === 'ArrowLeft' ? -2 : 2))
        }
      }}
    />
  )
}
