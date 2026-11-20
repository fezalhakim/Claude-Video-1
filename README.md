# PGear — Performance Meter (RaceBox & Dragy)

Aplikasi web progresif (PWA) untuk mengukur prestasi kenderaan menggunakan GPS **RaceBox** atau **Dragy** melalui Bluetooth (Web Bluetooth). Boleh dipasang ke skrin utama telefon dan berfungsi luar talian.

## Ciri-ciri
- **Sambung terus** ke RaceBox Mini / Mini S / Micro, Dragy, GPS telefon, atau mod Demo (simulator).
- **Pengukuran:** 0-60, 0-100, 0-150, 0-200, 60-100, 80-120, 100-200 km/j, 60ft, 100ft, 330ft, 1/8 batu, 1000ft, 1/4 batu (dengan trap speed), dan brek 100-0.
- Mula automatik bila kenderaan bergerak dari pegun; pilihan **rollout 1 kaki**.
- Masa dikira dari **cap masa GNSS peranti** dan diinterpolasi antara sampel (bukan masa ketibaan Bluetooth).
- Paparan langsung: kelajuan, satelit, fix, kadar Hz, bateri, G-meter, graf kelajuan.
- Sejarah larian bernombor (Run 1, Run 2, ...), rekod terbaik, eksport CSV, pengumuman suara.
- **Butiran larian** (tekan mana-mana run dalam Sejarah): keputusan, G maks, laju maks, pemandu & kereta, satelit, cerun, DA (ketinggian ketumpatan), beza tinggi, suhu; graf pecutan (g) + ketinggian + kelajuan dengan paksi **Masa atau Jarak**; jadual split (Jarak / Kelajuan / Bergolek & Brek) dengan G, laju dan split; togol rollout yang mengira semula keputusan; pilihan **"Banding dengan"** untuk tindih larian lain pada graf dan tunjuk beza masa setiap metrik serta titik tukar gear.
- **Pengesanan tukar gear automatik:** titik tukar gear ditanda pada graf, dengan jarak, kelajuan, masa dan G yang hilang setiap kali tukar gear.
- **Banding larian:** pilih Run A vs Run B — jadual beza masa setiap metrik + graf kelajuan bertindih (paksi masa atau jarak) + perbandingan titik tukar gear.

## Cara guna
1. Hos fail ini di HTTPS (cth. GitHub Pages) atau jalankan secara lokal: `npm start` → buka `http://localhost:8080`.
2. Buka di **Chrome (Android/PC)** atau **Bluefy (iPhone)** — Safari iOS tidak menyokong Web Bluetooth.
3. Tekan **RaceBox** atau **Dragy**, pilih peranti, tunggu fix 3D, berhenti, kemudian pecut.

## Protokol
- **RaceBox:** protokol BLE rasmi (Nordic UART, paket UBX `0xFF 0x01`, 80 bait, sehingga 25 Hz) — termasuk data G-force & bateri.
- **Dragy:** protokol tidak didokumenkan secara rasmi. PGear membaca aliran NMEA (RMC/GGA) melalui servis UART BLE biasa (FFE0, FFF0, Nordic UART, ISSC). Jika peranti anda tidak dikesan, hidupkan tetapan *"tunjuk semua peranti BLE"*. **Perlu diuji dengan peranti sebenar.**

## Ujian
```
npm test
```

> ⚠️ Gunakan hanya di litar atau kawasan tertutup. Patuhi undang-undang jalan raya.
