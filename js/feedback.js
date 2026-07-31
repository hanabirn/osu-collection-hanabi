/* ===== Suggestions & Improvements — private, write-only Google Sheets backend =====
   Deliberately has no read/fetch counterpart — messages are never displayed on
   the page, only appended to a Sheet only the site owner can open. Shared with
   the other Hanabi sites via the same Apps Script Web App endpoint. */
const FEEDBACK_API = 'https://script.google.com/macros/s/AKfycby0XtYQeXLu1f9gj1vNNhTNdZyCAII2STh5JOhgVrOdgEZu56QpT3s7kVvkiTPTHbLB/exec';

async function handleFeedbackSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const message = form.elements.message.value.trim();
    if (!message) return false;

    // Honeypot: bots fill every field, real users never see or fill this one.
    if (form.elements.website && form.elements.website.value) {
        form.style.display = 'none';
        document.getElementById('feedback-success').style.display = 'block';
        setTimeout(() => {
            form.style.display = '';
            form.reset();
            document.getElementById('feedback-success').style.display = 'none';
        }, 3000);
        return false;
    }

    const submitBtn = form.querySelector('.feedback-submit');
    submitBtn.disabled = true;

    try {
        await fetch(FEEDBACK_API, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ message, context: `osu-collection-hanabi / ${siteLang}` })
        });

        form.style.display = 'none';
        document.getElementById('feedback-success').style.display = 'block';

        setTimeout(() => {
            form.style.display = '';
            form.reset();
            submitBtn.disabled = false;
            document.getElementById('feedback-success').style.display = 'none';
        }, 3000);
    } catch (e) {
        console.error('Feedback submit failed:', e);
        submitBtn.disabled = false;
    }

    return false;
}
