/* Hands the client the VAPID public key it needs to subscribe. Served from
   env (not hardcoded) so it can't drift from the private key push-cron
   signs with. Empty publicKey => push isn't configured => the client hides
   the toggle. */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    return {
        statusCode: 200,
        headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
        body: JSON.stringify({ vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '' }),
    };
};
