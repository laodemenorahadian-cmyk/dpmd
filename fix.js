const fs = require('fs');
let html = fs.readFileSync('c:\\\\Users\\\\My ASUS\\\\Documents\\\\css\\\\index.html', 'utf8');

const targetRegex = /setOpen\(true\);\s*const DRIVE_SEARCH_API_URL/;
const replacement = `setOpen(true);
    };

    // ── Apps Script Web App URL (opsional) ────────────────────────
    // Jika kamu deploy Apps Script sebagai Web App untuk membaca Drive,
    // isi URL-nya di sini. Biarkan kosong jika belum ada.
    const DRIVE_SEARCH_API_URL`;

if (targetRegex.test(html)) {
    html = html.replace(targetRegex, replacement);
    fs.writeFileSync('c:\\\\Users\\\\My ASUS\\\\Documents\\\\css\\\\index.html', html);
    console.log('Fixed successfully!');
} else {
    console.log('Target not found!');
}
