# Upload to GitHub — use git CLI (not the web UI)

The GitHub **website "Add file / upload"** often fails on repos with many multi-MB GeoJSON files even when every file is under the 100 MB limit.

## Do this on your computer

```bash
# Download and unzip the package, then:
cd powergridxplr

git init
git remote add origin https://github.com/YOUR_USER/PowerGridXplr.git

# If the remote already has commits:
# git pull origin main --allow-unrelated-histories

git add -A
git commit -m "PowerGridXplr dashboard"
git branch -M main
git push -u origin main
```

If the remote has an old broken tree and you want to replace it:

```bash
git push -u origin main --force
```

Only force-push if you intend to overwrite the remote history.

## Optional: Git LFS (if push still rejects a file)

```bash
git lfs install
git lfs track "public/data/*.geojson"
git add .gitattributes public/data
git commit -m "Track large geojson with LFS"
git push
```

## GitHub Pages

Repo **Settings → Pages → Source: GitHub Actions** (workflow included).
