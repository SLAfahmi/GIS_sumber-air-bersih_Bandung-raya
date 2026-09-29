# 🗺️ Web Pemetaan Sumber Air Bersih & Air Siap Minum (Node.js + Leaflet)

## 📌 Deskripsi Proyek
Proyek ini adalah aplikasi GIS Web (Geographic Information System) interaktif berbasis Node.js untuk memetakan fasilitas sumber air bersih dan titik air siap minum. Aplikasi menampilkan titik lokasi pada peta interaktif Leaflet.js dengan filter dinamis dan data yang bersumber dari Database Relasional.

---

## 🛠️ Tech Stack Requirements
- **Backend Runtime:** Node.js (v18+)
- **Framework Web:** Express.js
- **Database:** MySQL / PostgreSQL
- **ORM:** Prisma ORM
- **CSV Parser:** `csv-parser`
- **Frontend:** Native HTML5, Tailwind CSS (via CDN/Build), Leaflet.js (v1.9+), gunakan referensi tampilannya pada folder referensi_dashboard dan referensi_update_titik. Lakukan analisis dari kedua file referensi tersebut supaya mirip UI nya
- **Architecture Pattern:** RESTful API + Static File Serving 

---

## 📂 Struktur File Project

```text
water-map-app/
├── config/
│   └── database.js
├── controllers/
│   └── fasilitasController.js
├── database/
│   └── Data Air Bersih_TPWB(Data Air Bersih).csv (ini data yang akan dimasukan ke SQL)
├── prisma/
│   ├── schema.prisma
│   └── seed.js
├── public/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
├── routes/
│   └── api.js
├── .env
├── PLAN.md
├── package.json
└── server.js