import QRCode from 'qrcode';
import confetti from 'canvas-confetti';
import { parseQRPayload } from './services/isbnParser.js';
import { getBookDetailsByISBN, saveCustomTrainedBarcode } from './services/bookApi.js';
import { 
  getSavedBooks, 
  saveScannedBook, 
  duplicateBookRange,
  parseAccessionRange,
  getNextAccessionNumber,
  deleteBook, 
  clearAllBooks, 
  searchAndFilterBooks, 
  exportToJSON, 
  exportToCSV,
  getGoogleSheetWebhookUrl,
  setGoogleSheetWebhookUrl,
  syncBooksToGoogleSheet,
  onShelfUpdate,
  startMultiUserSync
} from './services/storage.js';

// DOM Elements
const scannedCountEl = document.getElementById('scanned-count');
const totalPagesCountEl = document.getElementById('total-pages-count');
const booksGridEl = document.getElementById('books-grid');
const shelfCounterBadgeEl = document.getElementById('shelf-counter-badge');
const continuousScanToggle = document.getElementById('continuous-scan-toggle');

const manualScanForm = document.getElementById('manual-scan-form');
const manualIsbnInput = document.getElementById('manual-isbn-input');

const shelfSearchInput = document.getElementById('shelf-search-input');
const filterStatusSelect = document.getElementById('filter-status-select');
const sortSelect = document.getElementById('sort-select');

const btnExportCsv = document.getElementById('btn-export-csv');
const btnExportJson = document.getElementById('btn-export-json');
const btnClearAll = document.getElementById('btn-clear-all');

const bookModal = document.getElementById('book-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalContentContainer = document.getElementById('modal-content-container');
const toastContainer = document.getElementById('toast-container');

/**
 * Toast Notification Helper
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️'}</span>
    <span>${escapeHtml(message)}</span>
  `;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

/**
 * Trigger celebratory confetti burst on book scan success
 */
function triggerConfetti() {
  try {
    confetti({
      particleCount: 45,
      spread: 60,
      origin: { y: 0.7 }
    });
  } catch (e) {
    // optional
  }
}

/**
 * Handle new scanned text input (from USB barcode scanner, manual, or paste)
 */
async function processScannedCode(rawText) {
  if (!rawText) return;

  const parsed = parseQRPayload(rawText);
  if (!parsed) {
    showToast(`Could not recognize a valid ISBN format: "${rawText}"`, 'error');
    return;
  }

  const accessionInputEl = document.getElementById('manual-accession-input');
  const currentAccNo = accessionInputEl ? accessionInputEl.value.trim() || '17400' : '17400';

  showToast(`🔍 Searching RTC metadata for "${rawText}"...`, 'info');

  try {
    let bookDetails = null;

    if (parsed && parsed.type === 'json_book') {
      bookDetails = parsed.data;
    } else {
      const codeToSearch = (parsed && parsed.isbn) ? parsed.isbn : rawText.trim();
      bookDetails = await getBookDetailsByISBN(codeToSearch);
    }

    if (bookDetails) {
      const saved = saveScannedBook({
        ...bookDetails,
        accessionNumber: bookDetails.accessionNumber || currentAccNo
      });

      // Auto-increment accession number for subsequent scans if numeric
      if (accessionInputEl && !isNaN(currentAccNo)) {
        accessionInputEl.value = (parseInt(currentAccNo) + 1).toString();
      }

      renderLibraryShelf();
      triggerConfetti();

      if (saved.isUserTrained) {
        showToast(`Scanned trained book #${saved.accessionNumber}: "${saved.title}"!`, 'success');
      } else {
        showToast(`✨ Acc No #${saved.accessionNumber}: "${saved.title}" (${saved.source || 'Scanned'})!`, 'success');
      }

      // Open detail modal unless continuous scan is active
      if (!continuousScanToggle || !continuousScanToggle.checked) {
        openBookModal(saved.id);
      }
    }
  } catch (err) {
    console.error('Error processing scanned code:', err);
    showToast('Failed to fetch book data. Please check connection.', 'error');
  }
}

/**
 * Render the Library Shelf Grid
 */
function renderLibraryShelf() {
  const query = shelfSearchInput ? shelfSearchInput.value : '';
  const status = filterStatusSelect ? filterStatusSelect.value : 'all';
  const sortBy = sortSelect ? sortSelect.value : 'newest';

  const books = searchAndFilterBooks({ query, status, sortBy });
  const allBooks = getSavedBooks();

  // Update Stats
  if (scannedCountEl) scannedCountEl.textContent = allBooks.length;
  const totalPages = allBooks.reduce((sum, b) => sum + (parseInt(b.pages) || 0), 0);
  if (totalPagesCountEl) totalPagesCountEl.textContent = totalPages.toLocaleString();
  if (shelfCounterBadgeEl) shelfCounterBadgeEl.textContent = `${books.length} ${books.length === 1 ? 'Book' : 'Books'}`;

  if (books.length === 0) {
    booksGridEl.innerHTML = `
      <div class="empty-shelf-state">
        <div class="empty-icon-glow">📚</div>
        <h3>RTC Library Shelf is Empty</h3>
        <p>${query ? 'No books matched your search filters.' : 'Point your handheld USB barcode scanner at a book barcode or enter an ISBN code above to add books to your library shelf.'}</p>
      </div>
    `;
    return;
  }

  booksGridEl.innerHTML = books.map(book => {
    const authors = book.authors ? book.authors.join(', ') : 'Unknown Author';

    let coverHtml = '';
    if (book.coverUrl) {
      coverHtml = `<img src="${book.coverUrl}" alt="${book.title}" class="card-cover-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                   <div class="procedural-cover" style="display:none;">
                     <div class="procedural-title">${escapeHtml(book.title)}</div>
                     <div class="procedural-author">${escapeHtml(authors)}</div>
                   </div>`;
    } else {
      coverHtml = `
        <div class="procedural-cover">
          <div class="procedural-title">${escapeHtml(book.title)}</div>
          <div class="procedural-author">${escapeHtml(authors)}</div>
        </div>
      `;
    }

    const isTrainedBadge = book.isUserTrained ? `<span class="card-source-tag" style="background:#059669;">Trained / Manual</span>` : `<span class="card-source-tag">${escapeHtml(book.source || 'Scanned')}</span>`;

    return `
      <div class="book-card" data-id="${book.id}">
        <div class="card-cover-wrapper">
          ${coverHtml}
          ${isTrainedBadge}
        </div>

        <div class="card-body">
          <h3 class="card-title">${escapeHtml(book.title)}</h3>
          <p class="card-authors">${escapeHtml(authors)}</p>

          <div class="card-meta-row">
            <span class="isbn-pill" style="background:rgba(16, 185, 129, 0.15); color:#34d399; border-color:rgba(16, 185, 129, 0.3);">🏷️ #${escapeHtml(book.accessionNumber || '17400')}</span>
            ${book.isSyncedToSheet 
              ? `<span class="isbn-pill" style="background:rgba(16, 185, 129, 0.2); color:#10b981; border-color:#10b981; font-weight:700;">✓ Synced</span>`
              : `<span class="isbn-pill" style="background:rgba(245, 158, 11, 0.15); color:#f59e0b; border-color:rgba(245, 158, 11, 0.3);">⏳ Unsynced</span>`}
            <span class="isbn-pill">ISBN: ${escapeHtml(book.isbn || 'N/A')}</span>
            <span>📖 ${book.pages || 0} p.</span>
          </div>

          <p class="card-description">${escapeHtml(book.description || 'No description available.')}</p>

          <div class="card-actions">
            <button class="btn btn-cyan-gradient btn-view-details" data-id="${book.id}">View Details</button>
            <button class="btn btn-glass-outline btn-duplicate-book" data-id="${book.id}" title="Add copy" style="color:#38bdf8;">📋 Copy</button>
            <button class="btn btn-glass-outline btn-edit-details" data-id="${book.id}" title="Train barcode">⚡ Edit</button>
            <button class="btn btn-danger-ghost btn-delete-book" data-id="${book.id}" title="Remove book">&times;</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach Event Listeners to cards
  document.querySelectorAll('.btn-view-details').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openBookModal(btn.dataset.id);
    });
  });

  document.querySelectorAll('.btn-duplicate-book').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const books = getSavedBooks();
      const targetBook = books.find(b => b.id === id);
      const suggestedAcc = getNextAccessionNumber();

      const userAccInput = prompt(
        `Enter Accession Number or Range for Duplicate Copies of "${targetBook?.title || 'Book'}":\n\n(Examples: ${suggestedAcc} or ${suggestedAcc}-${parseInt(suggestedAcc) + 4})`,
        suggestedAcc
      );

      if (userAccInput === null) return;
      const copies = duplicateBookRange(id, userAccInput);
      if (copies && copies.length > 0) {
        const lastAccNo = copies[0].accessionNumber;
        const manualAccInput = document.getElementById('manual-accession-input');
        if (manualAccInput && !isNaN(lastAccNo)) {
          manualAccInput.value = (parseInt(lastAccNo) + 1).toString();
        }
        renderLibraryShelf();
        triggerConfetti();
        showToast(`📋 Created ${copies.length} Duplicate Copies!`, 'success');
      }
    });
  });

  document.querySelectorAll('.btn-edit-details').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openBookModal(btn.dataset.id, true);
    });
  });

  document.querySelectorAll('.btn-delete-book').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      deleteBook(id);
      renderLibraryShelf();
      showToast('Book removed from library shelf.', 'info');
    });
  });
}

/**
 * Open Book Detail Modal
 */
async function openBookModal(bookId, editMode = false) {
  const books = getSavedBooks();
  const book = books.find(b => b.id === bookId || b.isbn === bookId);
  if (!book) return;

  const authors = book.authors ? book.authors.join(', ') : 'Unknown Author';
  const qrString = `qr${book.isbn || book.id}`;

  if (editMode) {
    modalContentContainer.innerHTML = `
      <div style="padding: 1.75rem;">
        <h2 style="font-family:var(--font-heading); font-size: 1.4rem; font-weight:800; margin-bottom: 0.4rem;">⚡ Train / Edit Details: ${escapeHtml(book.title)}</h2>
        <p style="color:var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem;">
          Edit book details for barcode <strong>${escapeHtml(book.isbn)}</strong>. Future scans will display your trained info!
        </p>

        <form id="train-barcode-form" style="display:flex; flex-direction:column; gap: 1rem;">
          <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
            <div>
              <label style="font-size:0.8rem; font-weight:600; color:var(--emerald-light);">Accession No *</label>
              <input type="text" id="train-accession" class="form-control-glow font-mono" value="${escapeHtml(book.accessionNumber || '17400')}" required style="width:100%; border:1px solid var(--border-glass); padding:0.6rem;">
            </div>
            <div>
              <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted);">Full Title *</label>
              <input type="text" id="train-title" class="form-control-glow" value="${escapeHtml(book.title)}" required style="width:100%; border:1px solid var(--border-glass); padding:0.6rem;">
            </div>
            <div>
              <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted);">Subtitle</label>
              <input type="text" id="train-subtitle" class="form-control-glow" value="${escapeHtml(book.subtitle || '')}" style="width:100%; border:1px solid var(--border-glass); padding:0.6rem;">
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div>
              <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted);">Author(s) *</label>
              <input type="text" id="train-authors" class="form-control-glow" value="${escapeHtml(authors)}" required style="width:100%; border:1px solid var(--border-glass); padding:0.6rem;">
            </div>
            <div>
              <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted);">Publisher</label>
              <input type="text" id="train-publisher" class="form-control-glow" value="${escapeHtml(book.publisher || '')}" style="width:100%; border:1px solid var(--border-glass); padding:0.6rem;">
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
            <div>
              <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted);">Publish Year</label>
              <input type="text" id="train-date" class="form-control-glow" value="${escapeHtml(book.publishDate || '')}" style="width:100%; border:1px solid var(--border-glass); padding:0.6rem;">
            </div>
            <div>
              <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted);">Pages</label>
              <input type="number" id="train-pages" class="form-control-glow" value="${book.pages || 0}" style="width:100%; border:1px solid var(--border-glass); padding:0.6rem;">
            </div>
            <div>
              <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted);">Cover URL</label>
              <input type="url" id="train-cover" class="form-control-glow" value="${escapeHtml(book.coverUrl || '')}" placeholder="https://..." style="width:100%; border:1px solid var(--border-glass); padding:0.6rem;">
            </div>
          </div>

          <div>
            <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted);">Summary / Description</label>
            <textarea id="train-description" class="form-control-glow" rows="4" style="width:100%; border:1px solid var(--border-glass); padding:0.6rem;">${escapeHtml(book.description || '')}</textarea>
          </div>

          <div style="display:flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem;">
            <button type="button" id="btn-cancel-train" class="btn btn-glass-outline">Cancel</button>
            <button type="submit" class="btn btn-emerald-gradient">⚡ Save & Train Details</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('btn-cancel-train')?.addEventListener('click', () => openBookModal(book.id, false));

    document.getElementById('train-barcode-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const updatedData = {
        ...book,
        accessionNumber: document.getElementById('train-accession').value.trim() || '17400',
        title: document.getElementById('train-title').value.trim(),
        subtitle: document.getElementById('train-subtitle').value.trim(),
        authors: document.getElementById('train-authors').value.split(',').map(a => a.trim()).filter(Boolean),
        publisher: document.getElementById('train-publisher').value.trim(),
        publishDate: document.getElementById('train-date').value.trim(),
        pages: parseInt(document.getElementById('train-pages').value) || 0,
        coverUrl: document.getElementById('train-cover').value.trim() || null,
        description: document.getElementById('train-description').value.trim(),
        isUserTrained: true,
        source: 'Trained Barcode'
      };

      saveCustomTrainedBarcode(book.isbn, updatedData);
      saveScannedBook(updatedData);
      renderLibraryShelf();
      showToast(`Saved Book #${updatedData.accessionNumber} ("${updatedData.title}")!`, 'success');
      openBookModal(book.id, false);
    });

  } else {
    modalContentContainer.innerHTML = `
      <div style="padding:2rem; display:grid; grid-template-columns: 240px 1fr; gap:2rem;">
        <div style="display:flex; flex-direction:column; gap:1.25rem; align-items:center;">
          <div style="width:100%; max-width:220px; border-radius:14px; overflow:hidden; border:1px solid var(--border-glass); box-shadow:0 12px 30px rgba(0,0,0,0.6);">
            ${book.coverUrl ? `<img src="${book.coverUrl}" style="width:100%; height:290px; object-fit:cover;" alt="${book.title}">` : `
              <div class="procedural-cover" style="height:280px;">
                <div class="procedural-title">${escapeHtml(book.title)}</div>
                <div class="procedural-author">${escapeHtml(authors)}</div>
              </div>
            `}
          </div>

          <div style="width:100%; background:rgba(255,255,255,0.03); border:1px solid var(--border-glass); border-radius:14px; padding:1rem; text-align:center;">
            <div style="background:#fff; padding:0.5rem; border-radius:8px; display:inline-block; margin-bottom:0.5rem;">
              <canvas id="modal-qr-canvas"></canvas>
            </div>
            <p style="font-size:0.75rem; color:var(--text-muted); font-family:var(--font-mono);">Code: <strong>${escapeHtml(qrString)}</strong></p>
          </div>

          <div style="display:flex; flex-direction:column; gap:0.5rem; width:100%;">
            <button id="modal-duplicate-btn" class="btn btn-cyan-gradient" style="width:100%;">📋 Duplicate / Copy</button>
            <button id="modal-train-btn" class="btn btn-glass-outline" style="width:100%;">⚡ Edit Details</button>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:1rem;">
          <h2 style="font-family:var(--font-heading); font-size:1.6rem; font-weight:800; line-height:1.2;">${escapeHtml(book.title)}</h2>
          ${book.subtitle ? `<p style="color:var(--text-muted); font-size:0.95rem;">${escapeHtml(book.subtitle)}</p>` : ''}
          <p style="color:var(--cyan-light); font-weight:600;">By ${escapeHtml(authors)}</p>

          <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:0.75rem; background:rgba(255,255,255,0.03); padding:1rem; border-radius:14px; border:1px solid var(--border-glass);">
            <div>
              <span style="font-size:0.72rem; color:var(--text-dim); text-transform:uppercase;">🏷️ Accession No</span>
              <div style="font-size:0.95rem; font-weight:700; color:var(--emerald-light); font-family:var(--font-mono);">#${escapeHtml(book.accessionNumber || '17400')}</div>
            </div>
            <div>
              <span style="font-size:0.72rem; color:var(--text-dim); text-transform:uppercase;">ISBN Code</span>
              <div style="font-size:0.9rem; font-weight:600; font-family:var(--font-mono);">${escapeHtml(book.isbn || 'N/A')}</div>
            </div>
            <div>
              <span style="font-size:0.72rem; color:var(--text-dim); text-transform:uppercase;">Publisher</span>
              <div style="font-size:0.9rem; font-weight:600;">${escapeHtml(book.publisher || 'N/A')}</div>
            </div>
            <div>
              <span style="font-size:0.72rem; color:var(--text-dim); text-transform:uppercase;">Publish Year</span>
              <div style="font-size:0.9rem; font-weight:600;">${escapeHtml(book.publishDate || 'N/A')}</div>
            </div>
            <div>
              <span style="font-size:0.72rem; color:var(--text-dim); text-transform:uppercase;">Source</span>
              <div style="font-size:0.85rem; font-weight:600; color:var(--cyan-light);">${escapeHtml(book.source || 'Catalog')}</div>
            </div>
            <div>
              <span style="font-size:0.72rem; color:var(--text-dim); text-transform:uppercase;">Sync Status</span>
              <div style="font-size:0.85rem; font-weight:700; color:${book.isSyncedToSheet ? '#10b981' : '#f59e0b'};">${book.isSyncedToSheet ? '✓ Synced to Sheet' : '⏳ Pending Sync'}</div>
            </div>
          </div>

          <div>
            <h4 style="color:#fff; margin-bottom:0.4rem; font-family:var(--font-heading);">Summary</h4>
            <p style="font-size:0.9rem; color:var(--text-muted); line-height:1.6;">${escapeHtml(book.description || 'No description available.')}</p>
          </div>
        </div>
      </div>
    `;

    try {
      const canvas = document.getElementById('modal-qr-canvas');
      if (canvas) {
        await QRCode.toCanvas(canvas, qrString, {
          width: 140,
          margin: 1,
          color: { dark: '#040711', light: '#ffffff' }
        });
      }
    } catch (err) {
      console.warn('QR render error:', err);
    }

    document.getElementById('modal-duplicate-btn')?.addEventListener('click', () => {
      const suggestedAcc = getNextAccessionNumber();
      const userAccInput = prompt(
        `Enter Accession Number for Copy of "${book.title}":`,
        suggestedAcc
      );
      if (userAccInput === null) return;
      const copies = duplicateBookRange(book.id, userAccInput);
      if (copies && copies.length > 0) {
        renderLibraryShelf();
        bookModal.classList.add('hidden');
        triggerConfetti();
        showToast(`📋 Created Copy #${copies[0].accessionNumber}!`, 'success');
      }
    });

    document.getElementById('modal-train-btn')?.addEventListener('click', () => openBookModal(book.id, true));
  }

  bookModal.classList.remove('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * ➕ Add Book Manually Modal Dialog (Matches User UI Design 100%)
 */
function openAddManualBookModal(initialData = {}) {
  const defaultAcc = initialData.accessionNumber || getNextAccessionNumber();

  modalContentContainer.innerHTML = `
    <div style="padding: 2rem;">
      <div style="margin-bottom: 1.5rem;">
        <h2 style="font-family:var(--font-heading); font-size: 1.5rem; font-weight:800; color:#10b981; display:flex; align-items:center; gap:0.6rem;">
          <span style="font-size:1.4rem;">➕</span> Add Book Manually
        </h2>
        <p style="color:var(--text-muted); font-size: 0.85rem; margin-top:0.25rem;">
          Enter your book details manually with your custom Accession Number (e.g. 17400).
        </p>
      </div>

      <form id="manual-add-book-form" style="display:flex; flex-direction:column; gap: 1.1rem;">
        <!-- Row 1: Accession No & ISBN -->
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:#059669; display:block; margin-bottom:0.4rem;">
              Accession No or Range (e.g. 17401-17410) *
            </label>
            <input type="text" id="manual-form-accession" class="form-control-glow font-mono" value="${escapeHtml(defaultAcc)}" placeholder="17400" required style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:#059669; font-weight:700;">
          </div>
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:0.4rem;">
              Barcode / ISBN
            </label>
            <input type="text" id="manual-form-isbn" class="form-control-glow font-mono" value="${escapeHtml(initialData.isbn || '')}" placeholder="e.g. 9788131713518 or 17400" style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:var(--text-main);">
          </div>
        </div>

        <!-- Row 2: Title & Authors -->
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:0.4rem;">
              Full Book Title *
            </label>
            <input type="text" id="manual-form-title" class="form-control-glow" value="${escapeHtml(initialData.title || '')}" placeholder="e.g. Programming in C" required style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:var(--text-main);">
          </div>
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:0.4rem;">
              Author(s) (comma separated) *
            </label>
            <input type="text" id="manual-form-authors" class="form-control-glow" value="${escapeHtml(Array.isArray(initialData.authors) ? initialData.authors.join(', ') : (initialData.authors || ''))}" placeholder="e.g. Stephen G. Kochan" required style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:var(--text-main);">
          </div>
        </div>

        <!-- Row 3: Publisher, Publish Year, Page Count, Price -->
        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 1rem;">
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:0.4rem;">
              Publisher
            </label>
            <input type="text" id="manual-form-publisher" class="form-control-glow" value="${escapeHtml(initialData.publisher || '')}" placeholder="e.g. Pearson Educat" style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:var(--text-main);">
          </div>
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:0.4rem;">
              Publish Year
            </label>
            <input type="text" id="manual-form-year" class="form-control-glow" value="${escapeHtml(initialData.publishDate || '')}" placeholder="2023" style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:var(--text-main);">
          </div>
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:0.4rem;">
              Page Count
            </label>
            <input type="number" id="manual-form-pages" class="form-control-glow" value="${initialData.pages || ''}" placeholder="350" style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:var(--text-main);">
          </div>
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:#059669; display:block; margin-bottom:0.4rem;">
              Price (₹)
            </label>
            <input type="text" id="manual-form-price" class="form-control-glow font-mono" value="${escapeHtml(initialData.price || '130')}" placeholder="130" style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:#059669; font-weight:700;">
          </div>
        </div>

        <!-- Row 4: Category / Subject & Cover Image URL -->
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:0.4rem;">
              Category / Subject
            </label>
            <input type="text" id="manual-form-category" class="form-control-glow" value="${escapeHtml(Array.isArray(initialData.categories) ? initialData.categories.join(', ') : (initialData.categories || ''))}" placeholder="e.g. Computer Science, Programming" style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:var(--text-main);">
          </div>
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:0.4rem;">
              Cover Image URL
            </label>
            <input type="url" id="manual-form-cover" class="form-control-glow" value="${escapeHtml(initialData.coverUrl || '')}" placeholder="https://..." style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:var(--text-main);">
          </div>
        </div>

        <!-- Row 5: Book Summary / Description -->
        <div>
          <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:0.4rem;">
            Book Summary / Description
          </label>
          <textarea id="manual-form-description" class="form-control-glow" rows="3" placeholder="Summary of the book..." style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; font-family:var(--font-body); color:var(--text-main);">${escapeHtml(initialData.description || '')}</textarea>
        </div>

        <!-- Actions -->
        <div style="display:flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
          <button type="button" id="btn-cancel-manual-modal" class="btn btn-glass-outline">Cancel</button>
          <button type="submit" class="btn btn-emerald-gradient" style="font-weight:700; padding:0.65rem 1.4rem;">➕ Add to Library</button>
        </div>
      </form>
    </div>
  `;

  bookModal.classList.remove('hidden');

  document.getElementById('btn-cancel-manual-modal')?.addEventListener('click', () => {
    bookModal.classList.add('hidden');
  });

  document.getElementById('manual-add-book-form')?.addEventListener('submit', (e) => {
    e.preventDefault();

    const accInput = document.getElementById('manual-form-accession').value.trim();
    const isbnVal = document.getElementById('manual-form-isbn').value.trim() || `MAN-${Date.now().toString().slice(-6)}`;
    const titleVal = document.getElementById('manual-form-title').value.trim();
    const authorsVal = document.getElementById('manual-form-authors').value.split(',').map(a => a.trim()).filter(Boolean);
    const publisherVal = document.getElementById('manual-form-publisher').value.trim();
    const yearVal = document.getElementById('manual-form-year').value.trim();
    const pagesVal = parseInt(document.getElementById('manual-form-pages').value) || 0;
    const priceVal = document.getElementById('manual-form-price').value.trim() || '130';
    const categoryVal = document.getElementById('manual-form-category').value.split(',').map(c => c.trim()).filter(Boolean);
    const coverVal = document.getElementById('manual-form-cover').value.trim();
    const descVal = document.getElementById('manual-form-description').value.trim();

    const accList = parseAccessionRange(accInput);

    accList.forEach((accNo, idx) => {
      saveScannedBook({
        title: titleVal,
        authors: authorsVal.length > 0 ? authorsVal : ['Unknown Author'],
        isbn: isbnVal,
        accessionNumber: accNo,
        publisher: publisherVal,
        publishDate: yearVal,
        pages: pagesVal,
        price: priceVal,
        categories: categoryVal.length > 0 ? categoryVal : ['Academic'],
        coverUrl: coverVal || null,
        description: descVal,
        source: 'Manual Entry'
      });
    });

    const lastAcc = accList[accList.length - 1];
    const scannerAccInput = document.getElementById('manual-accession-input');
    if (scannerAccInput && !isNaN(lastAcc)) {
      scannerAccInput.value = (parseInt(lastAcc) + 1).toString();
    }

    renderLibraryShelf();
    triggerConfetti();
    bookModal.classList.add('hidden');
    showToast(`✨ Added ${accList.length} book entry(s) to Library Shelf!`, 'success');
  });
}

/**
 * 📝 Smart Paste & Auto-Fill All Details Modal Dialog (Matches User UI Design 100%)
 */
function openSmartPasteModal() {
  modalContentContainer.innerHTML = `
    <div style="padding: 2rem;">
      <div style="margin-bottom: 1.5rem;">
        <h2 style="font-family:var(--font-heading); font-size: 1.5rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.6rem;">
          <span style="font-size:1.4rem;">📝</span> Smart Paste & Auto-Fill All Details
        </h2>
        <p style="color:var(--text-muted); font-size: 0.85rem; margin-top:0.3rem; line-height:1.5;">
          Paste <strong>any raw unformatted text</strong> containing book details below (e.g. copied from Amazon, Flipkart, WhatsApp, PDF, or Catalog). Our AI will automatically extract Title, Authors, Barcode/ISBN, Publisher, Year, Pages, and Price to fill all fields instantly!
        </p>
      </div>

      <form id="smart-paste-form" style="display:flex; flex-direction:column; gap: 1.2rem;">
        <!-- Row 1: Accession No & Extraction Engine -->
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;">
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:#059669; display:block; margin-bottom:0.4rem;">
              Accession No or Range (e.g. 17401-17410)
            </label>
            <input type="text" id="smart-paste-accession" class="form-control-glow font-mono" value="${getNextAccessionNumber()}" placeholder="17400" required style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:#059669; font-weight:700;">
          </div>
          <div>
            <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:0.4rem;">
              Extraction Engine
            </label>
            <div style="background:#f0fdf4; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.65rem 0.85rem; color:var(--text-main); font-size:0.9rem; font-weight:600; display:flex; align-items:center; gap:0.5rem;">
              <span>🤖</span> AI Multi-Source Parser
            </div>
          </div>
        </div>

        <!-- Row 2: Paste Area -->
        <div>
          <label style="font-size:0.8rem; font-weight:700; color:#0284c7; display:block; margin-bottom:0.4rem;">
            Paste All Book Details in One Typing Area *
          </label>
          <textarea 
            id="smart-paste-textarea" 
            class="form-control-glow font-mono" 
            rows="9" 
            required 
            placeholder="Paste text here... Example:&#10;&#10;Title: Programming in C&#10;Author: Stephen G. Kochan&#10;ISBN: 9788131713518&#10;Publisher: Pearson Education India&#10;Year: 2023&#10;Price: 130&#10;Pages: 450"
            style="width:100%; background:#ffffff; border:1px solid rgba(5,150,105,0.25); border-radius:8px; padding:0.85rem; line-height:1.6; font-size:0.9rem; color:var(--text-main);"
          ></textarea>
        </div>

        <!-- Actions -->
        <div style="display:flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
          <button type="button" id="btn-cancel-smart-paste" class="btn btn-glass-outline">Cancel</button>
          <button type="submit" class="btn btn-cyan-gradient" style="font-weight:700; padding:0.65rem 1.4rem;">⚡ Extract & Fill All Details</button>
        </div>
      </form>
    </div>
  `;

  bookModal.classList.remove('hidden');

  document.getElementById('btn-cancel-smart-paste')?.addEventListener('click', () => {
    bookModal.classList.add('hidden');
  });

  document.getElementById('smart-paste-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const accVal = document.getElementById('smart-paste-accession').value.trim();
    const rawText = document.getElementById('smart-paste-textarea').value.trim();

    if (!rawText) return;

    showToast("🤖 AI Multi-Source Parser extracting details...", "info");

    const extracted = await parsePastedTextToBook(rawText);
    extracted.accessionNumber = accVal || getNextAccessionNumber();

    openAddManualBookModal(extracted);
    showToast("✨ Details extracted successfully! Review and click 'Add to Library'.", "success");
  });
}

/**
 * Intelligent Multi-Source Parser for raw pasted text
 */
async function parsePastedTextToBook(rawText) {
  const extracted = {
    title: '',
    authors: [],
    isbn: '',
    publisher: '',
    publishDate: '',
    pages: '',
    price: '130',
    categories: [],
    description: ''
  };

  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Title
    const titleMatch = line.match(/^(?:title|book title|name|full book title)\s*[:=\-]\s*(.+)$/i);
    if (titleMatch) extracted.title = titleMatch[1].trim();

    // Author
    const authorMatch = line.match(/^(?:author|authors|by|writer)\s*[:=\-]\s*(.+)$/i);
    if (authorMatch) extracted.authors = authorMatch[1].split(/[,;]/).map(a => a.trim()).filter(Boolean);

    // ISBN
    const isbnMatch = line.match(/^(?:isbn|isbn-13|isbn-10|barcode|code)\s*[:=\-]\s*(.+)$/i);
    if (isbnMatch) {
      extracted.isbn = isbnMatch[1].replace(/[^0-9X]/gi, '');
    } else {
      const standaloneIsbn = line.match(/\b(97[89]\d{10}|\d{9}[\dX])\b/i);
      if (standaloneIsbn && !extracted.isbn) extracted.isbn = standaloneIsbn[1];
    }

    // Publisher
    const pubMatch = line.match(/^(?:publisher|pub)\s*[:=\-]\s*(.+)$/i);
    if (pubMatch) extracted.publisher = pubMatch[1].trim();

    // Year
    const yearMatch = line.match(/^(?:year|publish year|date)\s*[:=\-]\s*(.+)$/i);
    if (yearMatch) extracted.publishDate = yearMatch[1].trim();

    // Pages
    const pagesMatch = line.match(/^(?:pages|page count|pages count|p\.)\s*[:=\-]\s*(\d+)/i);
    if (pagesMatch) extracted.pages = parseInt(pagesMatch[1]);

    // Price
    const priceMatch = line.match(/^(?:price|cost|mrp|rs|₹|inr)\s*[:=\-]\s*(.+)$/i);
    if (priceMatch) extracted.price = priceMatch[1].replace(/[^0-9.]/g, '');

    // Category
    const catMatch = line.match(/^(?:category|subject|genre)\s*[:=\-]\s*(.+)$/i);
    if (catMatch) extracted.categories = catMatch[1].split(/[,;]/).map(c => c.trim()).filter(Boolean);
  }

  // Fallback: If title wasn't explicitly prefixed with "Title:", pick the first non-key line
  if (!extracted.title && lines.length > 0) {
    const firstLine = lines[0];
    if (!firstLine.includes(':')) {
      extracted.title = firstLine;
    }
  }

  // If ISBN was found, attempt fast local dataset search to enrich missing fields!
  if (extracted.isbn) {
    try {
      const details = await getBookDetailsByISBN(extracted.isbn);
      if (details) {
        if (!extracted.title) extracted.title = details.title;
        if (!extracted.authors || extracted.authors.length === 0) extracted.authors = details.authors || [];
        if (!extracted.publisher) extracted.publisher = details.publisher;
        if (!extracted.publishDate) extracted.publishDate = details.publishDate;
        if (!extracted.pages) extracted.pages = details.pages;
        if (!extracted.coverUrl) extracted.coverUrl = details.coverUrl;
        if (!extracted.description) extracted.description = details.description;
      }
    } catch (e) {
      // search fallback
    }
  }

  return extracted;
}

/**
 * Event Listeners Initialization
 */
function initEventListeners() {
  // Manual Scan Form
  if (manualScanForm) {
    manualScanForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const inputVal = manualIsbnInput.value;
      if (inputVal) {
        processScannedCode(inputVal);
        manualIsbnInput.value = '';
      }
    });
  }

  // Search & Filter Controls
  if (shelfSearchInput) shelfSearchInput.addEventListener('input', renderLibraryShelf);
  if (filterStatusSelect) filterStatusSelect.addEventListener('change', renderLibraryShelf);
  if (sortSelect) sortSelect.addEventListener('change', renderLibraryShelf);

  // Add Manual Book Modal Trigger
  const btnAddManual = document.getElementById('btn-add-manual-book');
  if (btnAddManual) btnAddManual.addEventListener('click', () => openAddManualBookModal());

  // Smart Paste Modal Trigger
  const btnSmartPaste = document.getElementById('btn-smart-paste');
  if (btnSmartPaste) btnSmartPaste.addEventListener('click', () => openSmartPasteModal());

  const btnSyncSheet = document.getElementById('btn-sync-google-sheet');
  if (btnSyncSheet) {
    btnSyncSheet.addEventListener('click', async () => {
      const webhookUrl = getGoogleSheetWebhookUrl();
      if (!webhookUrl) {
        const url = prompt("Enter your Google Apps Script Webhook URL:");
        if (url) setGoogleSheetWebhookUrl(url);
        else return;
      }

      const currentBooks = getSavedBooks();
      if (currentBooks.length === 0) {
        showToast("Library shelf is empty. Scan or add books first to sync to Google Sheet.", "warning");
        return;
      }

      showToast("📊 Syncing shelf to Google Sheet...", "info");
      try {
        let res = await syncBooksToGoogleSheet();
        if (res.isAlreadySynced && currentBooks.length > 0) {
          if (confirm("All books are already marked as synced. Do you want to force re-sync all books to your Google Sheet?")) {
            res = await syncBooksToGoogleSheet(null, true);
          } else {
            showToast("All books are already synced to Google Sheet!", "info");
            return;
          }
        }

        renderLibraryShelf();
        triggerConfetti();
        showToast(`🎉 Synced ${res.count} book(s) to Google Sheet!`, "success");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  const btnSheetSettings = document.getElementById('btn-sheet-settings');
  if (btnSheetSettings) {
    btnSheetSettings.addEventListener('click', () => {
      const current = getGoogleSheetWebhookUrl();
      const url = prompt("Google Apps Script Webhook URL:", current);
      if (url !== null) {
        setGoogleSheetWebhookUrl(url);
        showToast("Webhook configuration updated!", "success");
      }
    });
  }

  if (btnExportCsv) btnExportCsv.addEventListener('click', () => exportToCSV());
  if (btnExportJson) btnExportJson.addEventListener('click', () => exportToJSON());
  if (btnClearAll) {
    btnClearAll.addEventListener('click', () => {
      if (confirm("Clear all scanned books from shelf?")) {
        clearAllBooks();
        renderLibraryShelf();
        showToast("Library cleared.", "info");
      }
    });
  }

  // Modal Close
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', () => bookModal.classList.add('hidden'));
  if (bookModal) {
    bookModal.addEventListener('click', (e) => {
      if (e.target === bookModal) bookModal.classList.add('hidden');
    });
  }
}

/**
 * App Initialization
 */
async function initApp() {
  initEventListeners();

  onShelfUpdate(() => {
    renderLibraryShelf();
  });

  startMultiUserSync(4000);
  renderLibraryShelf();
}

document.addEventListener('DOMContentLoaded', initApp);

