/**
 * ISBN and QR Payload Parser Utility
 */

/**
 * Validates ISBN-10 checksum
 */
export function isValidISBN10(isbn) {
  if (!/^\d{9}[\dX]$/i.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += (i + 1) * parseInt(isbn[i], 10);
  }
  const last = isbn[9].toUpperCase();
  sum += 10 * (last === 'X' ? 10 : parseInt(last, 10));
  return sum % 11 === 0;
}

/**
 * Validates ISBN-13 checksum
 */
export function isValidISBN13(isbn) {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(isbn[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(isbn[12], 10);
}

/**
 * Validates whether string is valid ISBN 10 or 13
 */
export function isValidISBN(isbn) {
  const clean = isbn.replace(/[- ]/g, '');
  return isValidISBN10(clean) || isValidISBN13(clean);
}

/**
 * Extract clean ISBN from any raw scanned text or QR code payload
 * Handles:
 * - "qr9789384608897" -> "9789384608897"
 * - "978-93-84608-89-7" -> "9789384608897"
 * - "ISBN: 9789384608897" -> "9789384608897"
 * - "https://www.google.com/search?q=9789384608897" -> "9789384608897"
 * - JSON string e.g. {"isbn": "9789384608897"}
 */
export function parseQRPayload(rawText) {
  if (!rawText) return null;

  const text = rawText.trim();

  // Try parsing JSON payload if QR contains rich data
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const data = JSON.parse(text);
      if (data.isbn) return parseQRPayload(String(data.isbn));
      if (data.ISBN) return parseQRPayload(String(data.ISBN));
      // If it contains book title directly
      if (data.title || data.Title) {
        return {
          type: 'json_book',
          data: {
            title: data.title || data.Title,
            author: data.author || data.Author || 'Unknown Author',
            publisher: data.publisher || data.Publisher || 'Independent',
            year: data.year || data.Year || new Date().getFullYear(),
            isbn: data.isbn || data.ISBN || 'QR-CUSTOM-' + Date.now().toString(36),
            description: data.description || 'Scanned from JSON QR Code'
          }
        };
      }
    } catch (e) {
      // Not JSON, continue regex matching
    }
  }

  // 1. Look for 13-digit sequence (e.g. 978... or 979...) anywhere in text
  const isbn13Match = text.match(/(?:978|979)[-\s]?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?\d/);
  if (isbn13Match) {
    const candidate = isbn13Match[0].replace(/[- ]/g, '');
    if (candidate.length === 13) {
      return {
        type: 'isbn',
        isbn: candidate,
        formattedIsbn: formatISBN13(candidate),
        isValid: isValidISBN13(candidate)
      };
    }
  }

  // 2. Look for explicit "qr" prefix like "qr9789384608897" or "QR9789384608897"
  const qrPrefixMatch = text.match(/^qr\s*(\d{10,13})/i);
  if (qrPrefixMatch) {
    const rawDigits = qrPrefixMatch[1];
    return {
      type: 'isbn',
      isbn: rawDigits,
      formattedIsbn: rawDigits.length === 13 ? formatISBN13(rawDigits) : rawDigits,
      isValid: isValidISBN(rawDigits)
    };
  }

  // 3. Extract all digits from string
  const cleanDigits = text.replace(/[^0-9X]/gi, '');
  if (cleanDigits.length >= 6) {
    return {
      type: 'isbn',
      isbn: cleanDigits,
      formattedIsbn: cleanDigits.length === 13 ? formatISBN13(cleanDigits) : cleanDigits,
      isValid: isValidISBN(cleanDigits)
    };
  }

  // 4. Return any scanned string/barcode as searchable code
  return {
    type: 'isbn',
    isbn: text,
    formattedIsbn: text,
    isValid: false
  };
}

/**
 * Format 13-digit ISBN into standard hyphenated display: 978-93-84608-89-7
 */
export function formatISBN13(isbn) {
  if (!isbn || isbn.length !== 13) return isbn;
  return `${isbn.slice(0, 3)}-${isbn.slice(3, 5)}-${isbn.slice(5, 10)}-${isbn.slice(10, 12)}-${isbn.slice(12)}`;
}
