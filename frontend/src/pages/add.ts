import { createLunch, getLunches, getLunchesWithoutImages, uploadImage, type Lunch, verifyAdminToken } from '../api'
import { findSimilar, fuzzyFilter } from '../fuzzy'
import { validateImageFile } from '../upload-validator'
import { openCropModal } from '../utils/crop-modal'

type Mode = 'new' | 'add-image'

export function renderAdd(container: HTMLElement): void {
  const content = document.createElement('div')
  content.className = 'page-content'
  content.style.maxWidth = '560px'
  container.appendChild(content)

  content.innerHTML = `<h1 class="page-heading">Add Lunch</h1>`

  let currentMode: Mode = 'new'
  let selectedFile: File | null = null

  const alertEl = document.createElement('div')
  alertEl.style.display = 'none'

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
    { label: 'New Lunch', value: 'new' },
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

    if (currentMode === 'new') {
      // --- Name field with duplicate detection ---
      const nameGroup = document.createElement('div')
      nameGroup.className = 'form-group'
      nameGroup.innerHTML = `<label class="form-label">Lunch Name</label><input class="form-input" type="text" placeholder="e.g. Margherita Pizza" maxlength="100" />`

      let allLunches: Lunch[] = []
      let warnDuplicates: { id: number; name: string; score: number }[] = []
      getLunches().then((l) => { allLunches = l }).catch(() => {})

      const dupeWarning = document.createElement('div')
      dupeWarning.className = 'duplicate-warning'
      dupeWarning.style.display = 'none'
      nameGroup.appendChild(dupeWarning)

      const nameInput = nameGroup.querySelector('input') as HTMLInputElement
      let dupeTimer: ReturnType<typeof setTimeout>
      nameInput.addEventListener('input', () => {
        clearTimeout(dupeTimer)
        dupeTimer = setTimeout(() => {
          const val = nameInput.value.trim()
          if (!val || val.length < 2) {
            dupeWarning.style.display = 'none'
            warnDuplicates = []
            return
          }
          warnDuplicates = findSimilar(val, allLunches, 0.6)
          if (warnDuplicates.length > 0) {
            dupeWarning.style.display = 'block'
            dupeWarning.textContent = '⚠ Similar dishes already exist:'
            const list = document.createElement('ul')
            warnDuplicates.forEach((d) => {
              const item = document.createElement('li')
              item.textContent = `${d.name} (${Math.round(d.score * 100)}% match)`
              list.appendChild(item)
            })
            dupeWarning.appendChild(list)
          } else {
            dupeWarning.style.display = 'none'
          }
        }, 300)
      })

      // --- Description ---
      const descriptionGroup = document.createElement('div')
      descriptionGroup.className = 'form-group'
      descriptionGroup.innerHTML = `<label class="form-label">Description</label><textarea class="form-input" placeholder="Optional notes about the lunch" maxlength="500" rows="3"></textarea>`

      // --- Vegan checkbox ---
      const veganGroup = document.createElement('label')
      veganGroup.className = 'checkbox-row'
      veganGroup.innerHTML = `<input type="checkbox" /> <span>Vegan dish? 🌿</span>`

      // --- Optional image upload ---
      const uploadGroup = document.createElement('div')
      uploadGroup.className = 'form-group'
      uploadGroup.innerHTML = `<label class="form-label">Image <span style="font-weight:400;opacity:0.6">(optional)</span></label>`

      const uploadArea = document.createElement('div')
      uploadArea.className = 'upload-area'
      uploadArea.innerHTML = `<p>Drop image here or click to select</p><p style="margin-top:4px;font-size:11px;">JPEG, PNG, WebP · max 5MB</p>`

      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = 'image/jpeg,image/png,image/webp'
      fileInput.style.display = 'none'
      uploadArea.appendChild(fileInput)

      const imagePreview = document.createElement('img')
      imagePreview.className = 'upload-preview'
      imagePreview.style.display = 'none'
      uploadArea.appendChild(imagePreview)

      uploadArea.addEventListener('click', () => fileInput.click())
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0]
        if (!file) return
        fileInput.value = ''
        const validation = await validateImageFile(file)
        if (!validation.valid) { showAlert(validation.error ?? 'Invalid file.', 'error'); return }
        const cropped = await openCropModal(file)
        if (!cropped) return
        selectedFile = cropped
        imagePreview.src = URL.createObjectURL(cropped)
        imagePreview.style.display = 'block'
        uploadArea.querySelector('p')!.textContent = cropped.name
      })
      uploadGroup.appendChild(uploadArea)

      // --- Password ---
      const tokenGroup = document.createElement('div')
      tokenGroup.className = 'form-group'
      tokenGroup.innerHTML = `<label class="form-label">Password</label><input class="form-input" type="password" placeholder="Enter the password to add lunches" />`

      const submitBtn = document.createElement('button')
      submitBtn.className = 'btn btn-primary btn-full'
      submitBtn.textContent = 'Add Lunch'

      formContainer.appendChild(nameGroup)
      formContainer.appendChild(descriptionGroup)
      formContainer.appendChild(veganGroup)
      formContainer.appendChild(uploadGroup)
      formContainer.appendChild(tokenGroup)
      formContainer.appendChild(submitBtn)
      formContainer.appendChild(alertEl)

      submitBtn.addEventListener('click', async () => {
        const token = (tokenGroup.querySelector('input') as HTMLInputElement).value.trim()
        if (!token) { showAlert('Password is required.', 'error'); return }

        const name = nameInput.value.trim()
        if (!name) { showAlert('Lunch name is required.', 'error'); return }

        const highMatch = warnDuplicates.find((d) => d.score >= 0.75)
        if (highMatch) {
          const proceed = window.confirm(`A similar dish already exists: "${highMatch.name}". Add anyway?`)
          if (!proceed) return
        }

        submitBtn.disabled = true
        submitBtn.textContent = 'Submitting…'

        const description = (descriptionGroup.querySelector('textarea') as HTMLTextAreaElement).value.trim()
        const isVegan = (veganGroup.querySelector('input') as HTMLInputElement).checked

        try {
          const sessionToken = await verifyAdminToken(token)
          const lunch = await createLunch(name, sessionToken, description || null, isVegan)
          const hadImage = !!selectedFile
          if (selectedFile) {
            await uploadImage(lunch.id, selectedFile, sessionToken)
          }
          nameInput.value = '';
          (descriptionGroup.querySelector('textarea') as HTMLTextAreaElement).value = '';
          (veganGroup.querySelector('input') as HTMLInputElement).checked = false
          selectedFile = null
          imagePreview.style.display = 'none'
          uploadArea.querySelector('p')!.textContent = 'Drop image here or click to select'
          showAlert(hadImage ? 'Lunch added with image!' : 'Lunch added!', 'success')
        } catch (e: unknown) {
          showAlert((e as Error).message ?? 'Failed to add lunch.', 'error')
        } finally {
          submitBtn.disabled = false
          submitBtn.textContent = 'Add Lunch'
        }
      })

      return
    }

    // --- Add Image to Existing mode ---
    const selectGroup = document.createElement('div')
    selectGroup.className = 'form-group'
    selectGroup.innerHTML = `<label class="form-label">Select Lunch</label>`

    const dropdownWrap = document.createElement('div')
    dropdownWrap.className = 'search-dropdown-wrap'

    const searchInput = document.createElement('input')
    searchInput.className = 'form-input'
    searchInput.placeholder = 'Search lunches…'
    searchInput.type = 'text'
    searchInput.autocomplete = 'off'

    const dropdownList = document.createElement('div')
    dropdownList.className = 'search-dropdown-list'
    dropdownList.style.display = 'none'

    dropdownWrap.appendChild(searchInput)
    dropdownWrap.appendChild(dropdownList)
    selectGroup.appendChild(dropdownWrap)

    let selectedExistingId: number | null = null
    let imagelessLunches: Lunch[] = []

    getLunchesWithoutImages()
      .then((lunches: Lunch[]) => {
        imagelessLunches = lunches
        renderDropdown('')
      })
      .catch(() => {
        dropdownList.innerHTML = '<div class="search-dropdown-empty">Failed to load lunches</div>'
      })

    function renderDropdown(query: string): void {
      const filtered = fuzzyFilter(query, imagelessLunches)
      dropdownList.innerHTML = ''
      if (filtered.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'search-dropdown-empty'
        empty.textContent = 'No matches found'
        dropdownList.appendChild(empty)
      } else {
        filtered.forEach((l) => {
          const item = document.createElement('div')
          item.className = 'search-dropdown-item'
          item.dataset.id = String(l.id)
          item.textContent = l.name
          item.addEventListener('click', () => {
            selectedExistingId = Number(item.dataset.id)
            searchInput.value = item.textContent ?? ''
            dropdownList.style.display = 'none'
          })
          dropdownList.appendChild(item)
        })
      }
    }

    searchInput.addEventListener('focus', () => {
      dropdownList.style.display = 'block'
      renderDropdown(searchInput.value)
    })
    searchInput.addEventListener('input', () => {
      selectedExistingId = null
      renderDropdown(searchInput.value)
      dropdownList.style.display = 'block'
    })
    document.addEventListener('click', (e) => {
      if (!dropdownWrap.contains(e.target as Node)) {
        dropdownList.style.display = 'none'
      }
    }, { once: false })

    const uploadGroup = document.createElement('div')
    uploadGroup.className = 'form-group'

    const uploadArea = document.createElement('div')
    uploadArea.className = 'upload-area'
    uploadArea.innerHTML = `<p>Drop image here or click to select</p><p style="margin-top:4px;font-size:11px;">JPEG, PNG, WebP · max 5MB</p>`

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'image/jpeg,image/png,image/webp'
    fileInput.style.display = 'none'
    uploadArea.appendChild(fileInput)

    const imagePreview = document.createElement('img')
    imagePreview.className = 'upload-preview'
    imagePreview.style.display = 'none'
    uploadArea.appendChild(imagePreview)

    uploadArea.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0]
      if (!file) return
      fileInput.value = ''
      const validation = await validateImageFile(file)
      if (!validation.valid) { showAlert(validation.error ?? 'Invalid file.', 'error'); return }
      const cropped = await openCropModal(file)
      if (!cropped) return
      selectedFile = cropped
      imagePreview.src = URL.createObjectURL(cropped)
      imagePreview.style.display = 'block'
      uploadArea.querySelector('p')!.textContent = cropped.name
    })
    uploadGroup.appendChild(uploadArea)

    const tokenGroup = document.createElement('div')
    tokenGroup.className = 'form-group'
    tokenGroup.innerHTML = `<label class="form-label">Password</label><input class="form-input" type="password" placeholder="Enter the password to add lunches" />`

    const submitBtn = document.createElement('button')
    submitBtn.className = 'btn btn-primary btn-full'
    submitBtn.textContent = 'Upload Image'

    formContainer.appendChild(selectGroup)
    formContainer.appendChild(uploadGroup)
    formContainer.appendChild(tokenGroup)
    formContainer.appendChild(submitBtn)
    formContainer.appendChild(alertEl)

    submitBtn.addEventListener('click', async () => {
      const token = (tokenGroup.querySelector('input') as HTMLInputElement).value.trim()
      if (!token) { showAlert('Password is required.', 'error'); return }
      if (!selectedExistingId) { showAlert('Select a lunch from the dropdown.', 'error'); return }
      if (!selectedFile) { showAlert('Please select an image.', 'error'); return }
      submitBtn.disabled = true
      submitBtn.textContent = 'Uploading…'
      try {
        const sessionToken = await verifyAdminToken(token)
        const upload = await uploadImage(selectedExistingId, selectedFile, sessionToken)
        imagelessLunches = imagelessLunches.filter((lunch) => lunch.id !== selectedExistingId)
        selectedExistingId = null
        selectedFile = null
        searchInput.value = ''
        imagePreview.src = upload.image_url
        imagePreview.style.display = 'block'
        uploadArea.querySelector('p')!.textContent = 'Uploaded image'
        renderDropdown('')
        showAlert('Image uploaded!', 'success')
      } catch (e: unknown) {
        showAlert((e as Error).message ?? 'Upload failed.', 'error')
      } finally {
        submitBtn.disabled = false
        submitBtn.textContent = 'Upload Image'
      }
    })
  }

  renderForm()
}
