# Use your own domain (weatherengine.org) through Cloudflare

Cloudflare answers at `weatherengine.org` and passes each request to the
Weather Engine on Google Cloud Run. The app, your password and your data stay
on Google; Cloudflare adds the short address and HTTPS. Free on Cloudflare's
Workers free plan (100,000 requests a day).

You need: the domain on Cloudflare (bought there, or its nameservers pointed
to Cloudflare), and your Cloud Run address, which you can find with:

```
gcloud run services describe weather-engine --region us-central1 --format 'value(status.url)'
```

or in the Google Cloud console: **Cloud Run → weather-engine → URL**.

## Steps (dash.cloudflare.com, ~5 minutes, works on a phone too)

1. **Create the Worker:** **Workers & Pages → Create → Create Worker**.
   Name it `weatherengine` → **Deploy**.
2. **Paste the code:** **Edit code**, delete what's there, paste the whole of
   [`cloudflare-worker.js`](cloudflare-worker.js) → **Deploy**.
3. **Point it at your app:** go to the Worker's **Settings → Variables and Secrets → Add**.
   - Type: Text
   - Name: `ORIGIN`
   - Value: your Cloud Run address, e.g. `https://weather-engine-123456.us-central1.run.app`
     (no slash at the end)

   Then **Deploy**.
4. **Attach the domain:** **Settings → Domains & Routes → Add → Custom domain**,
   enter `weatherengine.org` → **Add domain**. Repeat for `www.weatherengine.org`
   if you want that too. Cloudflare creates the DNS records and the certificate itself.
5. Wait a few minutes, then open **https://weatherengine.org** on your phone, log
   in, and **Share → Add to Home Screen**. Re-add the icon if you had the old address.

## Notes

- The old Cloud Run address keeps working; both are password-protected.
- Your login cookie belongs to whichever address you use, so you log in once on
  the new one.
- If the page says *"set the ORIGIN variable"*, step 3 is missing or has a typo.
- If it shows a Cloudflare error page (e.g. 522), check that ORIGIN starts with
  `https://` and matches the Cloud Run URL exactly.
- Updating the app is unchanged: `bash deploy/cloudrun.sh weather-engine-512923`.
  Nothing needs changing on Cloudflare.
