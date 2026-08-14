# Uploading to GitHub (avoid "file too large" / web UI failures)

GitHub’s **web drag-and-drop** often fails on many medium-sized data files even when none exceed the 100 MB hard limit.

## Recommended: push from your computer

```bash
# 1) Unzip this package
unzip PowerGridXplr-github.zip
cd powergridxplr

# 2) If repo already exists on GitHub:
git init
git remote add origin https://github.com/YOUR_USER/PowerGridXplr.git
git checkout -b main
git add -A
git commit -m "PowerGridXplr dashboard data and app"
git push -u origin main --force   # only force if replacing a broken tree
```

Or clone first, then copy files in:

```bash
git clone https://github.com/YOUR_USER/PowerGridXplr.git
cd PowerGridXplr
# copy contents of powergridxplr/ into this folder (overwrite)
git add -A
git commit -m "Update PowerGridXplr"
git push
```

## If a single file is still rejected

GitHub hard limit is **100 MB per file**. After compaction, no GeoJSON in this package should approach that.

Optional: Git LFS for the largest files:

```bash
git lfs install
git lfs track "public/data/*.geojson"
git add .gitattributes
git add public/data
git commit -m "Track geojson with LFS"
git push
```

## GitHub Pages

After push, enable **Settings → Pages → Deploy from GitHub Actions** (workflow already included).
