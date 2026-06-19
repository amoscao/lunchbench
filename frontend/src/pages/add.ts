import { createLunch, getLunchesWithoutImages, uploadImage, type Lunch } from '../api'
import { validateImageFile } from '../upload-validator'

type Mode = 'text' | 'text-image' | 'add-image'

export function renderAdd(container: HTMLElement): void {
  const content = document.createElement('div')
  content.className = 'page-content'
  content.style.maxWidth = '560px'
  container.appendChild(content)

  content.innerHTML = `<h1 class="page-heading">Add Lunch</h1>`

  let currentMode: Mode = 'text'
  let selectedFile: File | null = null

  const alertEl = document.createElement('div')
  alertEl.style.display = 'none'
  content.appendChild(alertEl)

  function showAlert(msg: string, type: 'success' | 'error'): void {
    alertEl.className = `alert alert-${type}`
    alertEl.textContent = msg
    alertEl.style.display = 'block'
    if (type === 'success') {
      setTimeout(() => { alertEl.style.display = 'none' }, 3000)
    }
  }

  const modeSelector = document.createElement('div')
  modeSelector.className = 'mode-selector'

  const modes: { label: string; value: Mode }[] = [
    { label: 'New Lunch', value: 'text' },
    { label: 'New Lunch + Image', value: 'text-image' },
    { label: 'Add Image to Existing', value: 'add-image' },
  ]

  modes.forEach(({ label, value }) => {
    const btn = document.createElement('button')
    btn.className = `mode-btn${value === currentMode ? ' active' : ''}`
    btn.textContent = label
    btn.addEventListener('click', () => {
      currentMode = value
      modeSelector.querySelectorAll('.mode-btn').forEach((b, i) => {
        b.classList.toggle('active', modes[i].value === value)
      })
      selectedFile = null
      alertEl.style.display = 'none'
      renderForm()
    })
    modeSelector.appendChild(btn)
  })
  content.appendChild(modeSelector)

  const formContainer = document.createElement('div')
  content.appendChild(formContainer)

  async function renderForm(): Promise<void> {
    formContainer.innerHTML = ''

    const nameGroup = document.createElement('div')
    nameGroup.className = 'form-group'
    nameGroup.innerHTML = `<label class="form-label">Lunch Name</label><input class="form-input" type="text" placeholder="e.g. Margherita Pizza" maxlength="100" />`

    const descriptionGroup = document.createElement('div')
    descriptionGroup.className = 'form-group'
    descriptionGroup.innerHTML = `<label class="form-label">Description</label><textarea class="form-input" placeholder="Optional notes about the lunch" maxlength="500" rows="3"></textarea>`

    const veganGroup = document.createElement('label')
    veganGroup.className = 'checkbox-row'
    veganGroup.innerHTML = `<input type="checkbox" /> <span>Vegan dish? 🌿</span>`

    const tokenGroup = document.createElement('div')
    tokenGroup.className = 'form-group'
    tokenGroup.innerHTML = `<label class="form-label">Password</label><input class="form-input" type="password" placeholder="Enter the password to add lunches" />`

    let uploadGroup: HTMLElement | null = null
    let selectGroup: HTMLElement | null = null
    let imagePreview: HTMLImageElement | null = null

    if (currentMode === 'text-image' || currentMode === 'add-image') {
      uploadGroup = document.createElement('div')
      uploadGroup.className = 'form-group'

      const uploadArea = document.createElement('label')
      uploadArea.className = 'upload-area'
      uploadArea.innerHTML = `<p>Drop image here or click to select</p><p style="margin-top:4px;font-size:11px;">JPEG, PNG, WebP · max 5MB</p>`

      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = 'image/jpeg,image/png,image/webp'
      fileInput.style.display = 'none'
      uploadArea.appendChild(fileInput)

      imagePreview = document.createElement('img')
      imagePreview.className = 'upload-preview'
      imagePreview.style.display = 'none'
      uploadArea.appendChild(imagePreview)

      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0]
        if (!file) return
        selectedFile = file
        imagePreview!.src = URL.createObjectURL(file)
        imagePreview!.style.display = 'block'
        uploadArea.querySelector('p')!.textContent = file.name
      })

      uploadGroup.appendChild(uploadArea)
    }

    if (currentMode === 'add-image') {
      selectGroup = document.createElement('div')
      selectGroup.className = 'form-group'
      selectGroup.innerHTML = `<label class="form-label">Select Lunch</label><select class="form-input form-select"><option>Loading…</option></select>`
      const select = selectGroup.querySelector('select')!

      getLunchesWithoutImages()
        .then((lunches: Lunch[]) => {
          if (lunches.length === 0) {
            select.innerHTML = '<option>No lunches without images</option>'
          } else {
            select.innerHTML = lunches.map((l) => `<option value="${l.id}">${l.name}</option>`).join('')
          }
        })
        .catch(() => { select.innerHTML = '<option>Failed to load</option>' })
    }

    const submitBtn = document.createElement('button')
    submitBtn.className = 'btn btn-primary btn-full'
    submitBtn.textContent = currentMode === 'add-image' ? 'Upload Image' : 'Add Lunch'

    if (currentMode === 'add-image') {
      if (selectGroup) formContainer.appendChild(selectGroup)
    } else {
      formContainer.appendChild(nameGroup)
      formContainer.appendChild(descriptionGroup)
      formContainer.appendChild(veganGroup)
    }

    if (uploadGroup) formContainer.appendChild(uploadGroup)
    formContainer.appendChild(tokenGroup)
    formContainer.appendChild(submitBtn)

    submitBtn.addEventListener('click', async () => {
      const token = (tokenGroup.querySelector('input') as HTMLInputElement).value.trim()
      if (!token) { showAlert('Password is required.', 'error'); return }

      const nameInput = nameGroup.querySelector('input') as HTMLInputElement | null
      const descriptionInput = descriptionGroup.querySelector('textarea') as HTMLTextAreaElement | null
      const veganInput = veganGroup.querySelector('input') as HTMLInputElement | null
      const description = descriptionInput?.value.trim() ?? ''
      const isVegan = veganInput?.checked ?? false

      if (currentMode === 'text') {
        const name = nameInput?.value.trim() ?? ''
        if (!name) { showAlert('Lunch name is required.', 'error'); return }
        submitBtn.disabled = true
        submitBtn.textContent = 'Submitting…'
        try {
          await createLunch(name, token, description || null, isVegan)
          nameInput!.value = ''
          if (descriptionInput) descriptionInput.value = ''
          if (veganInput) veganInput.checked = false
          showAlert('Lunch added!', 'success')
        } catch (e: unknown) {
          showAlert((e as Error).message ?? 'Failed to add lunch.', 'error')
        } finally {
          submitBtn.disabled = false
          submitBtn.textContent = 'Add Lunch'
        }
      } else if (currentMode === 'text-image') {
        const name = nameInput?.value.trim() ?? ''
        if (!name) { showAlert('Lunch name is required.', 'error'); return }
        if (!selectedFile) { showAlert('Please select an image.', 'error'); return }
        const validation = await validateImageFile(selectedFile)
        if (!validation.valid) { showAlert(validation.error ?? 'Invalid file.', 'error'); return }
        submitBtn.disabled = true
        submitBtn.textContent = 'Submitting…'
        try {
          const lunch = await createLunch(name, token, description || null, isVegan)
          await uploadImage(lunch.id, selectedFile, token)
          nameInput!.value = ''
          if (descriptionInput) descriptionInput.value = ''
          if (veganInput) veganInput.checked = false
          selectedFile = null
          if (imagePreview) imagePreview.style.display = 'none'
          showAlert('Lunch added with image!', 'success')
        } catch (e: unknown) {
          showAlert((e as Error).message ?? 'Failed.', 'error')
        } finally {
          submitBtn.disabled = false
          submitBtn.textContent = 'Add Lunch'
        }
      } else if (currentMode === 'add-image') {
        const select = selectGroup?.querySelector('select') as HTMLSelectElement | null
        const lunchId = Number(select?.value)
        if (!lunchId) { showAlert('Select a lunch.', 'error'); return }
        if (!selectedFile) { showAlert('Please select an image.', 'error'); return }
        const validation = await validateImageFile(selectedFile)
        if (!validation.valid) { showAlert(validation.error ?? 'Invalid file.', 'error'); return }
        submitBtn.disabled = true
        submitBtn.textContent = 'Uploading…'
        try {
          await uploadImage(lunchId, selectedFile, token)
          selectedFile = null
          if (imagePreview) imagePreview.style.display = 'none'
          showAlert('Image uploaded!', 'success')
          await renderForm()
        } catch (e: unknown) {
          showAlert((e as Error).message ?? 'Upload failed.', 'error')
        } finally {
          submitBtn.disabled = false
          submitBtn.textContent = 'Upload Image'
        }
      }
    })
  }

  renderForm()
}
