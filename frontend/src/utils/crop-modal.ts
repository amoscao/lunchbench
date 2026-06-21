export function openCropModal(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file)

    const backdrop = document.createElement('div')
    backdrop.className = 'crop-backdrop'

    const modal = document.createElement('div')
    modal.className = 'crop-modal'

    const header = document.createElement('div')
    header.className = 'crop-header'
    header.innerHTML = `
      <span class="crop-title">Crop Image</span>
      <span class="crop-hint">Drag corners to resize · Drag box to move</span>
    `

    const imgWrap = document.createElement('div')
    imgWrap.className = 'crop-img-wrap'

    const img = document.createElement('img')
    img.className = 'crop-full-img'
    img.src = objectUrl
    img.draggable = false

    const cropBox = document.createElement('div')
    cropBox.className = 'crop-box'
    cropBox.style.touchAction = 'none'
    ;(['nw', 'ne', 'sw', 'se'] as const).forEach((pos) => {
      const h = document.createElement('div')
      h.className = `crop-handle crop-handle-${pos}`
      h.dataset.handle = pos
      h.style.touchAction = 'none'
      cropBox.appendChild(h)
    })

    imgWrap.appendChild(img)
    imgWrap.appendChild(cropBox)

    const actions = document.createElement('div')
    actions.className = 'crop-actions'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'btn btn-secondary'
    cancelBtn.textContent = 'Cancel'
    const confirmBtn = document.createElement('button')
    confirmBtn.className = 'btn btn-primary'
    confirmBtn.textContent = 'Crop & Use'
    confirmBtn.disabled = true
    actions.appendChild(cancelBtn)
    actions.appendChild(confirmBtn)

    modal.appendChild(header)
    modal.appendChild(imgWrap)
    modal.appendChild(actions)
    backdrop.appendChild(modal)
    document.body.appendChild(backdrop)
    document.body.style.overflow = 'hidden'

    // Crop state in wrap-relative pixels
    let cropX = 0, cropY = 0, cropSize = 100

    function imgOffset(): { left: number; top: number } {
      const iRect = img.getBoundingClientRect()
      const wRect = imgWrap.getBoundingClientRect()
      return { left: iRect.left - wRect.left, top: iRect.top - wRect.top }
    }

    function clamp(v: number, lo: number, hi: number) {
      return Math.max(lo, Math.min(hi, v))
    }

    function applyBox() {
      const iRect = img.getBoundingClientRect()
      const wRect = imgWrap.getBoundingClientRect()
      const iLeft = iRect.left - wRect.left
      const iTop = iRect.top - wRect.top

      cropSize = clamp(cropSize, 20, Math.min(iRect.width, iRect.height))
      cropX = clamp(cropX, iLeft, iLeft + iRect.width - cropSize)
      cropY = clamp(cropY, iTop, iTop + iRect.height - cropSize)

      cropBox.style.left = `${cropX}px`
      cropBox.style.top = `${cropY}px`
      cropBox.style.width = `${cropSize}px`
      cropBox.style.height = `${cropSize}px`
    }

    function initCrop() {
      const iRect = img.getBoundingClientRect()
      const wRect = imgWrap.getBoundingClientRect()
      const { left, top } = { left: iRect.left - wRect.left, top: iRect.top - wRect.top }
      cropSize = Math.min(iRect.width, iRect.height) * 0.82
      cropX = left + (iRect.width - cropSize) / 2
      cropY = top + (iRect.height - cropSize) / 2
      applyBox()
    }

    const enableConfirm = () => setTimeout(() => {
      initCrop()
      confirmBtn.disabled = false
    }, 30)
    img.onload = enableConfirm
    img.onerror = enableConfirm

    // --- Drag ---
    type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move'
    let dragging: Handle | null = null
    let dragStartClient = { x: 0, y: 0 }
    let snapCrop = { x: 0, y: 0, size: 0 }

    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement
      const handle = target.dataset.handle as Handle | undefined
      if (handle) {
        dragging = handle
      } else if (cropBox.contains(target)) {
        dragging = 'move'
      } else {
        return
      }
      dragStartClient = { x: e.clientX, y: e.clientY }
      snapCrop = { x: cropX, y: cropY, size: cropSize }
      target.setPointerCapture(e.pointerId)
      e.preventDefault()
    }

    function onPointerMove(e: PointerEvent) {
      e.preventDefault()
      if (!dragging) return
      const dx = e.clientX - dragStartClient.x
      const dy = e.clientY - dragStartClient.y

      const iRect = img.getBoundingClientRect()
      const wRect = imgWrap.getBoundingClientRect()
      const iLeft = iRect.left - wRect.left
      const iTop = iRect.top - wRect.top
      const iRight = iLeft + iRect.width
      const iBottom = iTop + iRect.height

      if (dragging === 'move') {
        cropX = clamp(snapCrop.x + dx, iLeft, iRight - cropSize)
        cropY = clamp(snapCrop.y + dy, iTop, iBottom - cropSize)
      } else {
        // delta along the expansion diagonal
        let sizeDelta = 0
        let newX = snapCrop.x
        let newY = snapCrop.y

        if (dragging === 'se') {
          sizeDelta = (dx + dy) / 2
          const maxSize = Math.min(iRight - snapCrop.x, iBottom - snapCrop.y)
          cropSize = clamp(snapCrop.size + sizeDelta, 20, maxSize)
          cropX = snapCrop.x
          cropY = snapCrop.y
        } else if (dragging === 'sw') {
          sizeDelta = (-dx + dy) / 2
          const maxSize = Math.min(snapCrop.x + snapCrop.size - iLeft, iBottom - snapCrop.y)
          cropSize = clamp(snapCrop.size + sizeDelta, 20, maxSize)
          cropX = snapCrop.x + snapCrop.size - cropSize
          cropY = snapCrop.y
        } else if (dragging === 'ne') {
          sizeDelta = (dx - dy) / 2
          const maxSize = Math.min(iRight - snapCrop.x, snapCrop.y + snapCrop.size - iTop)
          cropSize = clamp(snapCrop.size + sizeDelta, 20, maxSize)
          cropX = snapCrop.x
          cropY = snapCrop.y + snapCrop.size - cropSize
        } else if (dragging === 'nw') {
          sizeDelta = (-dx - dy) / 2
          const maxSize = Math.min(snapCrop.x + snapCrop.size - iLeft, snapCrop.y + snapCrop.size - iTop)
          cropSize = clamp(snapCrop.size + sizeDelta, 20, maxSize)
          cropX = snapCrop.x + snapCrop.size - cropSize
          cropY = snapCrop.y + snapCrop.size - cropSize
        }

        void newX; void newY // satisfy TS (unused when not move)
      }

      applyBox()
    }

    function onPointerUp() { dragging = null }

    backdrop.addEventListener('pointerdown', onPointerDown)
    backdrop.addEventListener('pointermove', onPointerMove)
    backdrop.addEventListener('pointerup', onPointerUp)

    function cleanup() {
      URL.revokeObjectURL(objectUrl)
      document.body.style.overflow = ''
      document.body.removeChild(backdrop)
    }

    cancelBtn.addEventListener('click', () => { cleanup(); resolve(null) })

    confirmBtn.addEventListener('click', () => {
      const iRect = img.getBoundingClientRect()
      const { left: iLeft, top: iTop } = imgOffset()

      const scaleX = img.naturalWidth / iRect.width
      const scaleY = img.naturalHeight / iRect.height

      const srcX = (cropX - iLeft) * scaleX
      const srcY = (cropY - iTop) * scaleY
      const srcW = cropSize * scaleX
      const srcH = cropSize * scaleY
      const outputSize = Math.max(1, Math.round(Math.min(srcW, srcH)))

      const canvas = document.createElement('canvas')
      canvas.width = outputSize
      canvas.height = outputSize
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outputSize, outputSize)

      canvas.toBlob((blob) => {
        cleanup()
        if (!blob) { resolve(null); return }
        const ext = file.name.replace(/\.[^.]+$/, '')
        resolve(new File([blob], `${ext}.jpg`, { type: 'image/jpeg' }))
      }, 'image/jpeg', 0.92)
    })
  })
}
