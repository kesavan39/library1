/**
 * Library Storage & Data Management Service
 */

const STORAGE_KEY = 'bookpulse_scanned_library_v1';
const SYNC_CHANNEL_NAME = 'bookpulse_shelf_sync_channel';
const CLOUD_SYNC_URL = 'https://kvdb.io/BkPulseLib9981/shared_books';

const shelfUpdateCallbacks = new Set();
let broadcastChannel = null;

// Initialize BroadcastChannel for cross-tab multi-user sync
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    broadcastChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'SHELF_UPDATED') {
        notifySubscribers(event.data.books);
      }
    };
  } catch (e) {
    console.warn('BroadcastChannel error:', e);
  }
}

// Initialize window storage event for cross-window multi-user sync
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      const books = getSavedBooks();
      notifySubscribers(books);
    }
  });
}

/**
 * Register callback when library shelf is updated by any user or tab
 */
export function onShelfUpdate(callback) {
  if (typeof callback === 'function') {
    shelfUpdateCallbacks.add(callback);
  }
  return () => shelfUpdateCallbacks.delete(callback);
}

function notifySubscribers(books) {
  shelfUpdateCallbacks.forEach(cb => {
    try {
      cb(books);
    } catch (e) {
      console.error('Error in shelf update subscriber:', e);
    }
  });
}

/**
 * Get all saved books from local storage
 */
export function getSavedBooks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load books from localStorage:', e);
    return [];
  }
}

/**
 * Merge two lists of books cleanly without duplicates by unique id or accession number
 */
export function mergeBooksLists(listA, listB) {
  const map = new Map();
  
  (listA || []).forEach(b => {
    if (b && (b.id || b.accessionNumber)) {
      map.set(b.id || b.accessionNumber, b);
    }
  });

  (listB || []).forEach(b => {
    if (b && (b.id || b.accessionNumber)) {
      const key = b.id || b.accessionNumber;
      if (!map.has(key)) {
        map.set(key, b);
      } else {
        const existing = map.get(key);
        const existingTime = new Date(existing.scannedAt || 0).getTime();
        const bTime = new Date(b.scannedAt || 0).getTime();
        if (bTime > existingTime) {
          map.set(key, b);
        }
      }
    }
  });

  const merged = Array.from(map.values());
  merged.sort((a, b) => new Date(b.scannedAt || 0) - new Date(a.scannedAt || 0));
  return merged;
}

/**
 * Fetch books from multi-user shared cloud store
 */
export async function fetchCloudBooks() {
  try {
    const res = await fetch(CLOUD_SYNC_URL, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const cloudData = await res.json();
      return Array.isArray(cloudData) ? cloudData : [];
    }
  } catch (e) {
    // Cloud fetch fallback
  }
  return [];
}

/**
 * Push books to multi-user shared cloud store
 */
export async function pushCloudBooks(books) {
  try {
    const cloudBooks = await fetchCloudBooks();
    const merged = mergeBooksLists(books, cloudBooks);
    
    await fetch(CLOUD_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged)
    });
    return merged;
  } catch (e) {
    console.warn('Cloud sync push notice:', e);
    return books;
  }
}

/**
 * Perform a full multi-user cloud sync: fetch remote books, merge with local, and update both
 */
export async function syncCloudBooks() {
  const localBooks = getSavedBooks();
  const cloudBooks = await fetchCloudBooks();
  
  if (cloudBooks.length === 0 && localBooks.length === 0) {
    return [];
  }

  const merged = mergeBooksLists(localBooks, cloudBooks);
  
  // If merged has new items compared to local, update local storage & notify subscribers
  if (JSON.stringify(merged) !== JSON.stringify(localBooks)) {
    saveBooks(merged, true, false);
  }
  
  return merged;
}

let syncIntervalTimer = null;

/**
 * Start periodic multi-user background synchronization (polls every N seconds)
 */
export function startMultiUserSync(intervalMs = 4000) {
  if (syncIntervalTimer) clearInterval(syncIntervalTimer);
  
  // Initial sync
  syncCloudBooks().catch(() => {});
  
  // Periodic polling
  syncIntervalTimer = setInterval(() => {
    syncCloudBooks().catch(() => {});
  }, intervalMs);
}

/**
 * Save array of books to local storage & broadcast to all open users/tabs
 */
export function saveBooks(books, broadcast = true, pushCloud = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
    if (broadcast) {
      if (broadcastChannel) {
        broadcastChannel.postMessage({ type: 'SHELF_UPDATED', books, timestamp: Date.now() });
      }
      notifySubscribers(books);
    }
    if (pushCloud) {
      pushCloudBooks(books).catch(() => {});
    }
  } catch (e) {
    console.error('Failed to save books to localStorage:', e);
  }
}

/**
 * Add or update a book in the library
 */
/**
 * Add or update a book in the library
 * Duplicate ISBNs create new entries with distinct accession numbers unless bookData.id is passed for editing.
 */
export function saveScannedBook(bookData) {
  const books = getSavedBooks();
  
  // Find existing record ONLY if explicit id is passed (editing an existing record)
  const existingIndex = bookData.id ? books.findIndex(b => b.id === bookData.id) : -1;

  const updatedBook = {
    ...bookData,
    id: bookData.id || `book-${bookData.isbn || 'code'}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    accessionNumber: bookData.accessionNumber || '17400',
    scannedAt: bookData.scannedAt || new Date().toISOString(),
    status: bookData.status || 'scanned',
    rating: bookData.rating || 4.5,
    price: bookData.price || '130',
    userNotes: bookData.userNotes || '',
    tags: bookData.tags || ['Scanned']
  };

  if (existingIndex >= 0) {
    books[existingIndex] = { ...books[existingIndex], ...updatedBook };
  } else {
    books.unshift(updatedBook); // Add new copy to top of shelf
  }

  saveBooks(books);
  return updatedBook;
}

/**
 * Get next recommended accession number based on highest existing accession number
 */
export function getNextAccessionNumber() {
  const books = getSavedBooks();
  let maxAcc = 17399;
  books.forEach(b => {
    const num = parseInt(b.accessionNumber);
    if (!isNaN(num) && num > maxAcc) {
      maxAcc = num;
    }
  });
  return (maxAcc + 1).toString();
}

/**
 * Parse an accession number input string that may contain range notations
 * e.g. "17401-17410", "17401 to 17410", "17401, 17402, 17403", or "17401"
 */
export function parseAccessionRange(inputStr) {
  if (!inputStr || !String(inputStr).trim()) return [getNextAccessionNumber()];

  const str = String(inputStr).trim();

  // Check range format "17401-17410" or "17401 to 17410" or "17401:17410"
  const rangeMatch = str.match(/^(\d+)\s*(?:[-:]|\bto\b)\s*(\d+)$/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1]);
    const end = parseInt(rangeMatch[2]);
    if (!isNaN(start) && !isNaN(end) && end >= start && (end - start) < 500) {
      const list = [];
      for (let i = start; i <= end; i++) {
        list.push(i.toString());
      }
      return list;
    }
  }

  // Check comma or space separated list "17401, 17402, 17403"
  if (str.includes(',')) {
    const items = str.split(',').map(s => s.trim()).filter(Boolean);
    if (items.length > 0) return items;
  }

  return [str];
}

/**
 * Duplicate an existing book record to create another copy with a custom or next Accession Number
 */
export function duplicateBook(bookId, customAccessionNumber = null) {
  const books = getSavedBooks();
  const original = books.find(b => b.id === bookId || b.accessionNumber === bookId);
  if (!original) return null;

  const targetAccNo = (customAccessionNumber && String(customAccessionNumber).trim())
    ? String(customAccessionNumber).trim()
    : getNextAccessionNumber();

  const newCopy = {
    ...original,
    id: `book-${original.isbn || 'code'}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    accessionNumber: targetAccNo,
    scannedAt: new Date().toISOString(),
    userNotes: original.userNotes ? `${original.userNotes} (Copy #${targetAccNo})` : `Copy #${targetAccNo}`
  };

  books.unshift(newCopy);
  saveBooks(books);
  return newCopy;
}

/**
 * Duplicate a book record across a range or list of Accession Numbers (e.g. "17401-17410")
 */
export function duplicateBookRange(bookId, accessionInput) {
  const books = getSavedBooks();
  const original = books.find(b => b.id === bookId || b.accessionNumber === bookId);
  if (!original) return [];

  const accNumbers = parseAccessionRange(accessionInput);
  const newCopies = [];

  accNumbers.forEach((accNo, idx) => {
    const newCopy = {
      ...original,
      id: `book-${original.isbn || 'code'}-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
      accessionNumber: accNo,
      scannedAt: new Date(Date.now() + idx).toISOString(),
      userNotes: original.userNotes ? `${original.userNotes} (Copy #${accNo})` : `Copy #${accNo}`
    };
    newCopies.push(newCopy);
    books.unshift(newCopy);
  });

  saveBooks(books);
  return newCopies;
}

/**
 * Delete a specific book copy strictly by unique ID or Accession Number
 */
export function deleteBook(uniqueId) {
  const books = getSavedBooks();
  const filtered = books.filter(b => b.id !== uniqueId && b.accessionNumber !== uniqueId);
  saveBooks(filtered);
  return filtered;
}

/**
 * Clear entire library collection
 */
export function clearAllBooks() {
  saveBooks([], true, true);
  return [];
}

/**
 * Filter and search books in collection
 */
export function searchAndFilterBooks({ query = '', status = 'all', sortBy = 'newest' } = {}) {
  let books = getSavedBooks();

  if (status && status !== 'all') {
    books = books.filter(b => b.status === status);
  }

  if (query) {
    const q = query.toLowerCase().trim();
    books = books.filter(b => 
      (b.title && b.title.toLowerCase().includes(q)) ||
      (b.accessionNumber && b.accessionNumber.toLowerCase().includes(q)) ||
      (b.authors && b.authors.some(a => a.toLowerCase().includes(q))) ||
      (b.isbn && b.isbn.includes(q)) ||
      (b.publisher && b.publisher.toLowerCase().includes(q)) ||
      (b.categories && b.categories.some(c => c.toLowerCase().includes(q)))
    );
  }

  if (sortBy === 'newest') {
    books.sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));
  } else if (sortBy === 'oldest') {
    books.sort((a, b) => new Date(a.scannedAt) - new Date(b.scannedAt));
  } else if (sortBy === 'title') {
    books.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (sortBy === 'author') {
    books.sort((a, b) => (a.authors?.[0] || '').localeCompare(b.authors?.[0] || ''));
  } else if (sortBy === 'accession') {
    books.sort((a, b) => (a.accessionNumber || '').localeCompare(b.accessionNumber || '', undefined, { numeric: true }));
  }

  return books;
}

const GOOGLE_SHEET_WEBHOOK_KEY = 'bookpulse_google_sheet_webhook';
export const DEFAULT_GOOGLE_SHEET_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwUBBda2tWSZI065KXCc5zQVvRt4ngKnUGu8bKl0hUY1yTePDLag9QCTNW0mfo83Wpieg/exec';

export function getGoogleSheetWebhookUrl() {
  return localStorage.getItem(GOOGLE_SHEET_WEBHOOK_KEY) || DEFAULT_GOOGLE_SHEET_WEBHOOK_URL;
}

export function setGoogleSheetWebhookUrl(url) {
  if (url && url.trim()) {
    localStorage.setItem(GOOGLE_SHEET_WEBHOOK_KEY, url.trim());
  } else {
    localStorage.setItem(GOOGLE_SHEET_WEBHOOK_KEY, DEFAULT_GOOGLE_SHEET_WEBHOOK_URL);
  }
}

/**
 * Format a single book object into a 24-column array matching the exact Institutional Library Management headers
 */
export function formatBookToSheetRow(b) {
  const entryDate = b.scannedAt ? b.scannedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const pubYear = b.publishDate ? String(b.publishDate).slice(0, 4) : new Date().getFullYear().toString();
  
  let rawList = [];
  if (Array.isArray(b.authors)) {
    rawList = b.authors.flatMap(item => String(item).split(/[,;]/));
  } else if (typeof b.authors === 'string') {
    rawList = b.authors.split(/[,;]/);
  }
  const cleanedAuthors = rawList.map(a => a.trim().replace(/^and\s+/i, '')).filter(Boolean);
  const author1 = cleanedAuthors[0] || '';
  const author2 = cleanedAuthors[1] || '';
  const author3 = cleanedAuthors[2] || '';

  const categoriesArr = Array.isArray(b.categories) ? b.categories : [b.categories || 'Academic'];
  const firstAuthor = author1 || 'LIB';
  const authorCode = firstAuthor.split(' ').pop().slice(0, 3).toUpperCase();
  const callNo = b.callNumber || (b.isbn ? `620.${b.isbn.slice(-3)} ${authorCode}` : `620.1 ${authorCode}`);

  return [
    b.accessionNumber || '17400',
    b.title || 'Untitled Book',
    b.subtitle || '',
    author1,
    author2,
    author3,
    callNo,
    b.pages || 450,
    b.price || '130',
    b.edition || '1st Edition',
    b.volume || 'Vol 1',
    entryDate,
    b.isbn || '',
    b.publisher || 'Pearson Education India',
    pubYear,
    b.publisherPlace || 'India',
    categoriesArr.join(' / '),
    b.keywords || (b.title ? b.title.split(' ').slice(0, 4).join(', ') : 'Textbook'),
    b.department || 'Engineering Library',
    b.location || 'Main Shelf A-1',
    b.bookType || 'Book',
    b.billNumber || `BILL-${b.accessionNumber || '17400'}`,
    b.billDate || entryDate,
    b.state || 'AVAILABLE'
  ];
}

/**
 * Get list of books that have NOT been synced to Google Sheet yet
 */
export function getUnsyncedBooks() {
  const books = getSavedBooks();
  return books.filter(b => !b.isSyncedToSheet);
}

/**
 * Mark specified books as synced to Google Sheet
 */
export function markBooksAsSynced(targetBooks) {
  const books = getSavedBooks();
  const targets = Array.isArray(targetBooks) ? targetBooks : [targetBooks];
  const targetIds = new Set(targets.map(b => b.id || b.accessionNumber));
  const nowIso = new Date().toISOString();

  const updated = books.map(b => {
    if (targetIds.has(b.id) || targetIds.has(b.accessionNumber)) {
      return {
        ...b,
        isSyncedToSheet: true,
        syncedToSheetAt: nowIso
      };
    }
    return b;
  });

  saveBooks(updated);
  return updated;
}

/**
 * Sync / Append ONLY new unsynced books to live Google Sheet via Apps Script Webhook URL
 */
export async function syncBooksToGoogleSheet(booksToSync = null, forceAll = false) {
  const webhookUrl = getGoogleSheetWebhookUrl();
  if (!webhookUrl) {
    throw new Error("No Google Sheet Webhook URL configured. Please click '⚙️ Sheet Config' to enter your Apps Script Webhook URL.");
  }

  let list = [];
  if (booksToSync && Array.isArray(booksToSync)) {
    list = forceAll ? booksToSync : booksToSync.filter(b => !b.isSyncedToSheet);
  } else {
    const allBooks = getSavedBooks();
    list = forceAll ? allBooks : allBooks.filter(b => !b.isSyncedToSheet);
  }

  if (list.length === 0) {
    return { count: 0, isAlreadySynced: true };
  }

  const rows = list.map(formatBookToSheetRow);
  const jsonPayload = JSON.stringify(rows);

  // Transport 1: Direct text/plain JSON payload
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: jsonPayload
    });
  } catch (e1) {
    console.warn('Transport 1 Notice:', e1);
  }

  // Transport 2: Form-encoded payload fallback (guarantees e.parameter.payload on Apps Script)
  try {
    const formData = new URLSearchParams();
    formData.append('payload', jsonPayload);
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });
  } catch (e2) {
    console.warn('Transport 2 Notice:', e2);
  }

  // Mark all successfully sent books as synced in LocalStorage
  markBooksAsSynced(list);

  return { count: rows.length, isAlreadySynced: false, syncedBooks: list };
}

/**
 * Export library to JSON file
 */
export function exportToJSON() {
  const books = getSavedBooks();
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(books, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `bookpulse_library_export_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

/**
 * Export library to CSV file adhering strictly to Institutional Library Management Schema
 */
export function exportToCSV() {
  const books = getSavedBooks();
  if (books.length === 0) return;

  const headers = [
    'Accession Number',
    'Title',
    'Sub-Title',
    'Author 1',
    'Auth 2',
    'Auth 3',
    'Call Number',
    'Page',
    'Price',
    'Edition',
    'Volume',
    'Date of Entry ( YYYY-MM-DD)',
    'ISBN 13',
    'Publisher Name',
    'Publisher Year',
    'Publisher Place',
    'Subject Name',
    'Keyword',
    'Department',
    'Location',
    'Book Type (Book or Ref)',
    'Bill Number',
    'Bill Date',
    'STATE'
  ];

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const splitAuthorsCleanly = (authorsData) => {
    if (!authorsData) return ['', '', ''];
    let rawList = [];
    if (Array.isArray(authorsData)) {
      rawList = authorsData.flatMap(item => String(item).split(/[,;]/));
    } else if (typeof authorsData === 'string') {
      rawList = authorsData.split(/[,;]/);
    }
    const cleaned = rawList
      .map(a => a.trim().replace(/^and\s+/i, ''))
      .filter(Boolean);
    return [cleaned[0] || '', cleaned[1] || '', cleaned[2] || ''];
  };

  const rows = books.map(b => {
    const entryDate = b.scannedAt ? b.scannedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const pubYear = b.publishDate ? String(b.publishDate).slice(0, 4) : new Date().getFullYear().toString();
    const [author1, author2, author3] = splitAuthorsCleanly(b.authors);
    const categoriesArr = Array.isArray(b.categories) ? b.categories : [b.categories || 'Academic'];
    const firstAuthor = author1 || 'LIB';
    const authorCode = firstAuthor.split(' ').pop().slice(0, 3).toUpperCase();
    const callNo = b.callNumber || (b.isbn ? `620.${b.isbn.slice(-3)} ${authorCode}` : `620.1 ${authorCode}`);

    return [
      escapeCSV(b.accessionNumber || '17400'),
      escapeCSV(b.title || 'Untitled Book'),
      escapeCSV(b.subtitle || ''),
      escapeCSV(author1),
      escapeCSV(author2),
      escapeCSV(author3),
      escapeCSV(callNo),
      escapeCSV(b.pages || 450),
      escapeCSV(b.price || '130'),
      escapeCSV(b.edition || '1st Edition'),
      escapeCSV(b.volume || 'Vol 1'),
      escapeCSV(entryDate),
      escapeCSV(b.isbn || ''),
      escapeCSV(b.publisher || 'Pearson Education India'),
      escapeCSV(pubYear),
      escapeCSV(b.publisherPlace || 'India'),
      escapeCSV(categoriesArr.join(' / ')),
      escapeCSV(b.keywords || (b.title ? b.title.split(' ').slice(0, 4).join(', ') : 'Textbook')),
      escapeCSV(b.department || 'Engineering Library'),
      escapeCSV(b.location || 'Main Shelf A-1'),
      escapeCSV(b.bookType || 'Book'),
      escapeCSV(b.billNumber || `BILL-${b.accessionNumber || '17400'}`),
      escapeCSV(b.billDate || entryDate),
      escapeCSV(b.state || 'AVAILABLE')
    ].join(',');
  });

  // UTF-8 BOM for Microsoft Excel compatibility on Windows
  const bom = "\uFEFF";
  const csvString = bom + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Library_Books_Export_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
