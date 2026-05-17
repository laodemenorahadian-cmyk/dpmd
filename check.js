const fs = require('fs');
const html = fs.readFileSync('c:\\\\Users\\\\My ASUS\\\\Documents\\\\css\\\\index.html', 'utf8');
const scriptMatches = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)];

for (let i = 0; i < scriptMatches.length; i++) {
    const code = scriptMatches[i][1];
    if (code.trim().length > 0) {
        try {
            new Function(code);
        } catch (e) {
            console.error('Script block ' + (i+1) + ' syntax error:', e.message);
            console.error('---CODE---');
            const lines = code.split('\n');
            lines.forEach((l, idx) => console.log(`${idx + 1}: ${l}`));
            console.error('---END CODE---');
        }
    }
}
