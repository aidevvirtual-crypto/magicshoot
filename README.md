# Magic Shoot

Game tembak kelelawar multiplayer: HP jadi pistol (gyroscope), layar desktop jadi arena 3D.

## Menjalankan

```
npm install        # sekali saja
npm start          # atau klik dua kali start.bat
```

| Halaman | URL |
|---|---|
| Display (layar besar) | http://localhost:3000/ — klik sekali untuk musik, tekan **F** untuk layar penuh, **M** untuk mute musik |
| Controller HP | scan QR di layar (`https://<IP-LAN>:3443/play`) |
| Admin | http://localhost:3000/admin — password awal `admin123` (ganti di menu Pengaturan) |

Butuh Node.js 22.13 atau lebih baru (database memakai `node:sqlite` bawaan, file di `data/magicshoot.db`).

## Catatan jaringan

- HP dan PC harus di WiFi yang sama. Izinkan Node.js di Windows Firewall (port 3000 & 3443) saat diminta.
- Gyroscope di browser HP **wajib HTTPS**, jadi server membuat sertifikat self-signed di `data/certs/`.
  Saat pertama membuka, HP akan menampilkan peringatan: pilih *Advanced → Proceed* (Chrome) atau *Show Details → visit this website* (Safari).
- Jika tidak mau ada peringatan, pakai tunnel HTTPS (mis. `cloudflared tunnel --url http://localhost:3000`) lalu isi **URL publik** di Admin → Pengaturan; QR otomatis berubah.
- HP tanpa gyro tetap bisa main dengan mode sentuh (geser untuk membidik).

## Alur main

1. Scan QR → isi nama → masuk antrean (maks 5 pemain bersamaan, sisanya menunggu).
2. Saat giliran: aktifkan gyro, arahkan HP ke tengah layar, tekan **START** → hitung mundur.
3. Tap layar HP untuk menembak selama 30 detik (timer masing-masing pemain). Kena beruntun = combo, bat emas = poin x3.
4. Skor masuk Top 10 (skor terbaik per pemain). Slot dilepas dan pemain berikutnya di antrean masuk.
