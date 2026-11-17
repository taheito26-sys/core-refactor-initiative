# Google Play release guide — Raseed

This checklist is specific to the Capacitor Android app in this repository.

- Package name: `com.taheito26sys.corerefactorinitiative`
- App name: `Raseed`
- Current version: `versionCode 1`, `versionName "1.0"`
- Current compile/target SDK: `35`
- Required target SDK for new Play submissions: `36` (Android 16), effective August 31, 2026
- Output format: Android App Bundle (`.aab`)

Official references:

- [Target API level requirement](https://developer.android.com/google/play/requirements/target-sdk)
- [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en)
- [New personal account testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Device verification for new developer accounts](https://support.google.com/googleplay/android-developer/answer/14316361?hl=en)
- [Prepare and roll out a release](https://support.google.com/googleplay/android-developer/answer/9859348?hl=en)
- [SMS and Call Log permission policy](https://support.google.com/googleplay/android-developer/answer/10208820?hl=en)
- [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en)

## 1. Create the Google Play developer account

1. Go to <https://play.google.com/console/signup>.
2. Choose a personal or organization account. A personal account is simpler; an organization account needs legal-entity and D-U-N-S verification.
3. Pay the one-time 25 USD registration fee.
4. Complete identity verification.
5. For a new personal account, install the Play Console mobile app and complete the Android-device verification task.
6. New personal accounts created after November 13, 2023 must run a closed test with at least 12 testers opted in continuously for 14 days before applying for production access. Organization accounts follow separate verification requirements.

Start this early: identity verification and the 14-day closed test are the longest lead-time items.

## 2. Fix the Android release blockers

### 2.1 Target Android 16

Update `android/variables.gradle`:

```gradle
compileSdkVersion = 36
targetSdkVersion = 36
```

Use a recent Android Studio/AGP combination that supports API 36. The current project uses AGP 8.7.2 and a Gradle 9.4.1 wrapper; verify that pair with Android Studio's AGP Upgrade Assistant before building. Do not upload an AAB until the project builds cleanly against API 36.

### 2.2 Handle the restricted SMS permissions

The current manifest requests:

```xml
<uses-permission android:name="android.permission.READ_SMS" />
<uses-permission android:name="android.permission.RECEIVE_SMS" />
```

It also registers `.SmsReceiver` for `SMS_RECEIVED`. Google Play treats SMS permissions as highly restricted. Bank-balance parsing is not a standard permitted use case, and an app that is not the default SMS handler is likely to be rejected.

Choose one of these before submitting:

- Remove `READ_SMS`, `RECEIVE_SMS`, and the `SmsReceiver` declaration from the Play build, and hide/disable the bank-SMS balance feature in that build.
- Create a separate `play` product flavor with no SMS permissions, while keeping a direct-distribution build that retains the feature.
- Only if the app genuinely qualifies for an SMS exception, submit the Play Console Permissions Declaration Form and provide the required evidence. Do not assume approval.

Safer alternatives for the Play build are manual balance entry, a user-initiated bank/open-banking connection, or a notification-listener integration with clear disclosure and consent. The SMS Retriever API is for one-time verification codes, not for reading bank balance messages.

### 2.3 Versioning

For the first Play release, `versionCode 1` and `versionName "1.0"` are fine. Every later upload must use a higher `versionCode`:

```gradle
versionCode 2
versionName "1.0.1"
```

The package name is permanent and cannot be reused.

## 3. Create and protect the upload key

Do not commit the keystore or its passwords. Generate an upload key once and keep a secure offline backup:

```bash
keytool -genkeypair -v \
  -keystore upload-keystore.jks \
  -alias upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

The simplest signing path is Android Studio:

1. Open the `android` folder in Android Studio.
2. Choose **Build → Generate Signed Bundle / APK → Android App Bundle**.
3. Create or select the upload keystore.
4. Build the release bundle.

For command-line signing, add a `keystore.properties` file under `android/` and configure a release `signingConfig` in `android/app/build.gradle`. Add both the keystore and `keystore.properties` to `.gitignore`.

When you create the first release in Play Console, accept **Play App Signing**. Google manages the distribution signing key; your upload key signs the bundle you upload. Keep the upload key safe—losing it requires a Play Console key-reset request.

## 4. Build the release AAB

```bash
npm ci
npm run build
npx cap sync android
cd android
./gradlew bundleRelease
```

The signed bundle is written to:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

Before uploading:

- Install the release build on a physical Android device.
- Test sign-in, chat, notifications, location/shipment flows, camera/microphone, and any remaining balance feature.
- Confirm the release build is not debuggable.
- Confirm `google-services.json` is present and FCM notifications work.
- Run the Play pre-launch report after the first upload.

## 5. Create the app in Play Console

1. Open Play Console and choose **Create app**.
2. Enter `Raseed`.
3. Enter the package name `com.taheito26sys.corerefactorinitiative`.
4. Choose the default language, app/game type, and free/paid status.
5. Add a monitored support email.
6. Accept the Developer Program Policies, US export laws, and Play App Signing terms.
7. Complete the Dashboard setup tasks.

## 6. Complete App content declarations

These are mandatory before production:

- **Privacy policy** — a public HTTPS URL. The repository currently has no `/privacy` route, so create and deploy one before submitting.
- **App access** — provide a working reviewer account and any required test data. If the app uses email verification or 2FA, give reviewers a usable path or a dedicated test account.
- **Ads** — declare whether the app contains ads.
- **Content rating** — complete the questionnaire. Chat/user-generated content may affect the rating.
- **Target audience** — select the intended age groups accurately.
- **Data safety** — declare account identifiers, messages/chat, location, photos, audio/video, app activity, device identifiers, diagnostics, and any other data the app collects or shares. Include Supabase and Firebase as service providers where applicable.
- **Financial features** — declare any payments, crypto, trading, lending, or other financial functionality. If the app offers regulated financial services, check the applicable Play financial-services policy before submitting.
- **Government/news/health declarations** — complete only if applicable.

The data-safety answers must match the actual release build. If you remove the SMS feature for Play, do not declare SMS data collection for that build.

## 7. Store listing assets

Prepare:

- App name: `Raseed` (maximum 30 characters)
- Short description (maximum 80 characters)
- Full description (maximum 4,000 characters)
- App icon: 512 × 512 PNG; the existing `public/icon-512.png` can be reused after checking its background and safe area
- Feature graphic: 1024 × 500 PNG/JPEG; this asset is still needed
- At least 2 phone screenshots; 4–8 is better, portrait 9:16, minimum 320 px on the short side
- Optional tablet screenshots
- Category and tags
- Contact email and website
- Privacy policy URL

Choose the category honestly. If the core product is business/merchant management, **Business** may fit better than **Finance**; a Finance listing can trigger additional financial-feature review.

## 8. Closed test and production access

1. Create a **Closed testing** track.
2. Upload the signed AAB.
3. Add at least 12 testers by Google account email.
4. Send them the opt-in link and make sure they remain opted in continuously for 14 days.
5. Collect feedback and fix crashes, broken flows, and policy issues.
6. On the Dashboard, click **Apply for production**.
7. Answer the questions about the closed test, the app, and production readiness.
8. Wait for Google's review; Google says production-access review usually takes seven days or less, but can take longer.

If Google finds insufficient testers or engagement, continue the closed test and reapply.

## 9. Production release

1. Go to **Test and release → Production → Create new release**.
2. Upload the signed AAB.
3. Add release notes.
4. Select countries/regions.
5. Review the errors summary and resolve all blocking errors.
6. Start the rollout.
7. Google reviews the release. Once approved, it becomes available on Google Play.

## 10. Final pre-submit checklist

- [ ] Google Play developer account approved and identity/device verification complete
- [ ] Target SDK updated to 36 and release build succeeds
- [ ] SMS permissions removed or a valid permission declaration approved
- [ ] Upload keystore created, backed up, and excluded from Git
- [ ] Signed AAB built and tested on a physical Android device
- [ ] Privacy policy URL live
- [ ] Data safety form complete
- [ ] Content rating and target audience complete
- [ ] Ads declaration complete
- [ ] App access test credentials provided
- [ ] Store listing icon, feature graphic, screenshots, descriptions, and contact details complete
- [ ] Closed test with 12+ testers completed for 14 continuous days (personal accounts)
- [ ] Production access approved
- [ ] Production AAB uploaded and rollout started
