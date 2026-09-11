/* Kicks off the osu! OAuth authorization-code flow for Watch Replay. Uses a
   SEPARATE, dedicated osu! OAuth application from the one _osu-auth.js uses
   for client_credentials (that app is shared with the main site and has no
   redirect_uri of its own to register; authorization_code needs one bound
   to this site's own domain, so sharing would mean fighting over a single
   callback URL between two unrelated sites). Scope is "identify public" —
   "public" is required so replay-download.js can later call
   /scores/{id}/download as this user, not just read their own id.

   `return_to` is carried through as OAuth `state` so login can be
   triggered from any page (player.html, map.html, replay.html) and land
   back where the visitor started; osu-replay-callback.js validates it's a
   same-site relative path before redirecting there. */
exports.handler = async (event) => {
    const qs = event.queryStringParameters || {};
    const returnTo = typeof qs.return_to === 'string' && qs.return_to.startsWith('/') ? qs.return_to : '/';

    const params = new URLSearchParams({
        client_id: process.env.OSU_REPLAY_CLIENT_ID,
        redirect_uri: process.env.OSU_REPLAY_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify public',
        state: returnTo,
    });

    return {
        statusCode: 302,
        headers: { Location: `https://osu.ppy.sh/oauth/authorize?${params.toString()}` },
        body: '',
    };
};
