# MGear — Performance Meter (RaceBox & Dragy)

Aplikasi web progresif (PWA) untuk mengukur prestasi kenderaan menggunakan GPS **RaceBox** atau **Dragy** melalui Bluetooth (Web Bluetooth). Boleh dipasang ke skrin utama telefon dan berfungsi luar talian.

## Ciri-ciri
- **Import data Dragy / CSV** (Sejarah → Import): isi `templates/mgear-import-template.csv` (atau muat turun dari app) dengan keputusan Dragy, kemudian import. Larian ditanda "Import" dan muncul dalam Sejarah, Ikut metrik, Banding & Butiran. Fail eksport MGear juga boleh diimport; larian berganda dilangkau.
- **Import dari screenshot** (Sejarah → Import → 📷): MGear membaca screenshot laporan Dragy dengan OCR dalam pelayar (60ft, 330ft, 1/8 mile + trap, 0-100, suhu, DA, cerun, peranti), kemudian pengguna semak & simpan. Perlu internet kali pertama untuk memuat pembaca teks. **Graf dalam screenshot juga dibaca semula** (kelajuan, G, ketinggian) dan ditala dengan nilai jadual (60ft, 330ft, 1/8 + trap), jadi larian import ada graf penuh, metrik tambahan (0-60, 0-100, 100ft…) dan pengesanan tukar gear. Data Dragy dianggap **1ft rollout** (NHRA), sama seperti lalai MGear, supaya perbandingan adil.
- **Sejarah ikut metrik:** pilih 0-60, 0-100, 60ft, 1/8 batu, 1/4 batu dsb. untuk lihat semua run bagi metrik itu — disusun terpantas (🏆), beza dengan yang terbaik, graf prestasi, dan butang A/B untuk banding.
- **Pilih keputusan dipaparkan** (Tetapan): tandakan metrik yang mahu dilihat di skrin Ukur, ringkasan, rekod terbaik & suara. Semua metrik tetap direkod. Suhu dalam °C atau °F.
- **Mesra pengguna:** navigasi tab (Ukur / Sejarah / Tetapan), panduan 3 langkah kali pertama, senarai semak "Sedia" (Bersambung · GPS kuat · Berhenti), ringkasan automatik selepas larian dengan getaran, padam boleh dibatalkan ("Buat asal").
- **Pelbagai bahasa:** Bahasa Melayu, English, Bahasa Indonesia, 中文 (pilih di bahagian atas atau di Tetapan; bahasa telefon dikesan automatik kali pertama).
- **Sambung terus** ke RaceBox Mini / Mini S / Micro (25 Hz), Dragy (10 Hz), GPS telefon (~1 Hz), atau mod Demo (simulator).
- **Pengukuran:** 0-60, 0-100, 0-150, 0-200, 60-100, 80-120, 100-200, 200-250, 200-300 km/j, 60ft, 100ft, 330ft, 1/8 batu, 1000ft, 1/4 batu, 1/2 batu, 1 batu (dengan trap speed), dan brek 100-0.
- **Jarak tersuai** (Tetapan): tambah sehingga 10 jarak sendiri dalam m, ft atau batu (cth. 500 m, 1 km, 800 ft). Setiap ujian jarak tunjuk masa, laju di garisan dan **laju maksimum** dalam jarak itu. Larian lama yang ada data penuh dikira semula secara automatik.
- Mula automatik bila kenderaan bergerak dari pegun; **rollout 1 kaki ON secara lalai untuk ujian jarak** (60ft, 1/8, 1/4…); 0-100 & ujian kelajuan sentiasa dari pegun (boleh dimatikan di Tetapan).
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
- **Dragy:** protokol tidak didokumenkan secara rasmi. MGear membaca aliran NMEA (RMC/GGA) melalui servis UART BLE biasa (FFE0, FFF0, Nordic UART, ISSC). Jika peranti anda tidak dikesan, hidupkan tetapan *"tunjuk semua peranti BLE"*. **Perlu diuji dengan peranti sebenar.**

## Ujian
```
npm test
```

> ⚠️ Gunakan hanya di litar atau kawasan tertutup. Patuhi undang-undang jalan raya.
