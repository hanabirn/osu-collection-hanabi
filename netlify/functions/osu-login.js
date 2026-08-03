/* Kicks off the osu! OAuth authorization-code flow. Redirects the browser to
   osu!'s consent screen with the "identify" scope — the only thing we need
   is the visitor's own user id, so osu-callback.js can hand it straight back
   to the client and forget the token (see osu-callback.js for why no session
   is kept server-side). OSU_REDIRECT_URI must exactly match the callback URL
   registered in the osu! OAuth app settings. */
exports.handler = async () => {
    const params = new URLSearchParams({
        client_id: process.env.OSU_CLIENT_ID,
        redirect_uri: process.env.OSU_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify',
    });

    return {
        statusCode: 302,
        headers: { Location: `https://osu.ppy.sh/oauth/authorize?${params.toString()}` },
        body: '',
    };
};
