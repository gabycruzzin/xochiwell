# Xochiwell

*Xochi* (SO-chee) comes from the Nahuatl *xōchitl*, "flower". Xochiwell is about blooming and feeling well.

A small calorie and macro tracker with no ads, no paywall and no guilt trips. React + TypeScript + Vite.

## Set up the database (once)
Diary entries, goals and custom serving sizes are saved in [Supabase](https://supabase.com) (Postgres + sign-in).
1. Create a free Supabase project.
2. In the dashboard, open **SQL Editor**, paste in `supabase/schema.sql`, and run it.
3. Copy `.env.example` to `.env.local` and fill in the project URL and anon key from **Project Settings → API**.

Already set up the database before? Run any newer files in `supabase/migrations/` the same way.

## Run it
```
npm install
npm run dev
```

## Run it as an iOS app
Needs Xcode. The iOS project in `ios/` wraps the built web app with [Capacitor](https://capacitorjs.com).
```
npm run build
npx cap sync ios
npx cap open ios
```
Then pick a simulator or your iPhone in Xcode and press Run. Repeat the first two commands after changing web code.

### Upload a new TestFlight build
1. Raise the build number (`CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj`, or in Xcode under App → General → Build). Every upload needs a higher one.
2. From `ios/App`:
```
xcodebuild -project App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath build-release/Xochiwell.xcarchive -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath build-release/Xochiwell.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath build-release/export -allowProvisioningUpdates
```
Or in Xcode: Product → Archive, then Distribute App → App Store Connect. The build shows up under TestFlight in App Store Connect after Apple processes it.

## How it works
- Food data comes from [Open Food Facts](https://world.openfoodfacts.org) (free, no key). See `src/api.ts`.
- In the iOS app, **scan** next to the search box opens the camera ([@capacitor/barcode-scanner](https://capacitorjs.com/docs/apis/barcode-scanner))
  and looks the barcode up in Open Food Facts (`lookupBarcode` in `src/api.ts`). The camera prompt's text is `NSCameraUsageDescription` in `ios/App/App/Info.plist`.
  The dev server proxies its API (see `vite.config.ts`); a hosted build needs the same proxy.
- Accounts and data live in Supabase. See `src/db.ts`. Row level security in `supabase/schema.sql`
  means each user can only read and change their own rows.
- Anything logged in a browser before accounts existed is imported into the first account that signs in there.
- Goal setup is optional. New users choose between just logging and a short guided setup (`src/Setup.tsx`).
  Suggested goals come from a "typical day" of foods they enter, or their activity level (`src/goals.ts`). No body measurements are asked for or stored.

## Next steps
- Add USDA FoodData Central for whole foods (use a small backend so the API key stays private)
- Custom foods and recipes (also for scanned barcodes that aren't in the database)
