const prisma = require('../config/database');
const { KATEGORI, STATUS_OPERASIONAL, STATUS_VERIFIKASI } = require('../config/constants');

// Helper: include relasi wilayah & pengelola
const fasilitasInclude = {
  wilayah: true,
  pengelola: true,
};

// Helper: tambahkan nama relasi sebagai field datar agar mudah dipakai frontend
function transformFasilitas(item) {
  return {
    ...item,
    wilayahNama: item.wilayah?.nama || '',
    provinsi: item.wilayah?.provinsi || '',
    pengelolaNama: item.pengelola?.nama || '',
  };
}

// Helper: terjemahkan error Prisma yang umum menjadi respons yang jelas
function handlePrismaError(res, error, fallbackMessage) {
  if (error.code === 'P2002') {
    return res.status(409).json({ success: false, message: 'Node ID sudah digunakan oleh titik lain' });
  }
  if (error.code === 'P2003') {
    return res.status(400).json({ success: false, message: 'Wilayah atau pengelola yang dipilih tidak ditemukan' });
  }
  console.error(`${fallbackMessage}:`, error);
  return res.status(500).json({ success: false, message: fallbackMessage, error: error.message });
}

// Helper: validasi & normalisasi body request create/update
function parseFasilitasInput(body = {}, { partial = false } = {}) {
  const data = {};
  const has = (key) => body[key] !== undefined;
  const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';

  if (!partial) {
    const required = ['nodeId', 'wilayahId', 'pengelolaId', 'jenisFasilitas', 'latitude', 'longitude'];
    const missing = required.filter((key) => isBlank(body[key]));
    if (missing.length) {
      return { error: `Field wajib belum diisi: ${missing.join(', ')}` };
    }
  }

  if (has('nodeId')) {
    const value = String(body.nodeId).trim();
    if (!value) return { error: 'Node ID tidak boleh kosong' };
    data.nodeId = value;
  }

  for (const key of ['wilayahId', 'pengelolaId']) {
    if (!has(key)) continue;
    const value = parseInt(body[key], 10);
    if (isNaN(value)) return { error: `${key === 'wilayahId' ? 'Wilayah' : 'Pengelola'} tidak valid` };
    data[key] = value;
  }

  if (has('jenisFasilitas')) {
    const value = String(body.jenisFasilitas).trim();
    if (!value) return { error: 'Jenis fasilitas tidak boleh kosong' };
    data.jenisFasilitas = value;
  }

  if (has('latitude')) {
    const value = parseFloat(body.latitude);
    if (isNaN(value) || value < -90 || value > 90) return { error: 'Latitude harus berupa angka antara -90 dan 90' };
    data.latitude = value;
  }

  if (has('longitude')) {
    const value = parseFloat(body.longitude);
    if (isNaN(value) || value < -180 || value > 180) return { error: 'Longitude harus berupa angka antara -180 dan 180' };
    data.longitude = value;
  }

  if (has('statusOperasional')) {
    const value = String(body.statusOperasional).trim();
    if (!STATUS_OPERASIONAL.includes(value)) {
      return { error: `Status operasional harus salah satu dari: ${STATUS_OPERASIONAL.join(', ')}` };
    }
    data.statusOperasional = value;
  }

  if (has('kategori')) {
    const value = String(body.kategori).trim();
    if (!KATEGORI.includes(value)) {
      return { error: `Kategori harus salah satu dari: ${KATEGORI.join(', ')}` };
    }
    data.kategori = value;
  }

  if (has('statusVerifikasi')) {
    const value = String(body.statusVerifikasi ?? '').trim();
    if (value && !STATUS_VERIFIKASI.includes(value)) {
      return { error: `Status verifikasi harus salah satu dari: ${STATUS_VERIFIKASI.join(', ')}` };
    }
    data.statusVerifikasi = value || null;
  }

  if (has('sumberUrl')) {
    const value = String(body.sumberUrl ?? '').trim();
    if (value && !/^https?:\/\/\S+$/i.test(value)) return { error: 'Link Google Maps harus berupa URL http/https' };
    data.sumberUrl = value || null;
  }

  for (const key of ['nama', 'kecamatan', 'desaKelurahan', 'alamat', 'wilayahLayanan', 'catatanData']) {
    if (has(key)) data[key] = String(body[key] ?? '').trim() || null;
  }

  return { data };
}

// GET /api/fasilitas
const getAllFasilitas = async (req, res) => {
  try {
    const { provinsi, wilayah, jenisFasilitas, kategori, statusOperasional, search } = req.query;

    const where = {};

    if (wilayah && wilayah !== 'all') {
      where.wilayah = { is: { nama: { equals: wilayah } } };
    } else if (provinsi && provinsi !== 'all') {
      where.wilayah = { is: { provinsi: { equals: provinsi } } };
    }

    if (jenisFasilitas && jenisFasilitas !== 'all') {
      where.jenisFasilitas = { equals: jenisFasilitas };
    }

    if (kategori && kategori !== 'all') {
      where.kategori = { equals: kategori };
    }

    if (statusOperasional && statusOperasional !== 'all') {
      where.statusOperasional = { equals: statusOperasional };
    }

    if (search) {
      const term = search.trim();
      where.OR = [
        { nodeId: { contains: term } },
        { nama: { contains: term } },
        { kecamatan: { contains: term } },
        { desaKelurahan: { contains: term } },
        { alamat: { contains: term } },
        { jenisFasilitas: { contains: term } },
        { wilayah: { is: { nama: { contains: term } } } },
        { pengelola: { is: { nama: { contains: term } } } },
      ];
    }

    const data = await prisma.fasilitasAir.findMany({
      where,
      include: fasilitasInclude,
      orderBy: { id: 'asc' }
    });

    res.json({
      success: true,
      total: data.length,
      data: data.map(transformFasilitas)
    });
  } catch (error) {
    console.error('Error fetching fasilitas:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data fasilitas', error: error.message });
  }
};

// GET /api/fasilitas/:id  (id numerik atau Node ID)
const getFasilitasById = async (req, res) => {
  try {
    const { id } = req.params;
    const detailInclude = {
      ...fasilitasInclude,
      logPembaruan: { orderBy: { createdAt: 'desc' }, take: 20 },
    };

    let item = null;
    if (/^\d+$/.test(id)) {
      item = await prisma.fasilitasAir.findUnique({ where: { id: parseInt(id, 10) }, include: detailInclude });
    }
    if (!item) {
      item = await prisma.fasilitasAir.findUnique({ where: { nodeId: id }, include: detailInclude });
    }

    if (!item) {
      return res.status(404).json({ success: false, message: 'Fasilitas tidak ditemukan' });
    }

    res.json({ success: true, data: transformFasilitas(item) });
  } catch (error) {
    console.error('Error fetching detail:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil detail fasilitas', error: error.message });
  }
};

// POST /api/fasilitas
const createFasilitas = async (req, res) => {
  try {
    const { data, error } = parseFasilitasInput(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    const { _max } = await prisma.fasilitasAir.aggregate({ _max: { no: true } });
    const diubahOleh = req.user?.name || 'Petugas';

    const newItem = await prisma.fasilitasAir.create({
      data: {
        statusOperasional: 'Beroperasi Normal',
        kategori: 'Perumda',
        ...data,
        no: (_max.no || 0) + 1,
        sumberData: 'Input Petugas GIS',
        logPembaruan: {
          create: {
            fieldDiubah: 'dibuat',
            nilaiBaru: data.nodeId,
            diubahOleh,
            keterangan: 'Titik fasilitas baru ditambahkan',
          }
        }
      },
      include: fasilitasInclude
    });

    res.status(201).json({ success: true, message: 'Titik fasilitas berhasil ditambahkan', data: transformFasilitas(newItem) });
  } catch (error) {
    handlePrismaError(res, error, 'Gagal menambahkan titik fasilitas');
  }
};

// PUT /api/fasilitas/:id
const updateFasilitas = async (req, res) => {
  try {
    const numericId = parseInt(req.params.id, 10);
    if (isNaN(numericId)) return res.status(400).json({ success: false, message: 'ID titik tidak valid' });

    const existing = await prisma.fasilitasAir.findUnique({ where: { id: numericId }, include: fasilitasInclude });
    if (!existing) return res.status(404).json({ success: false, message: 'Data titik tidak ditemukan' });

    const { data: updateData, error } = parseFasilitasInput(req.body, { partial: true });
    if (error) return res.status(400).json({ success: false, message: error });

    // Susun audit trail: hanya field yang benar-benar berubah
    const logs = [];
    for (const [field, newVal] of Object.entries(updateData)) {
      if (field === 'wilayahId' || field === 'pengelolaId') continue;
      const oldVal = existing[field] ?? '';
      if (String(newVal ?? '') !== String(oldVal)) {
        logs.push({ fieldDiubah: field, nilaiLama: String(oldVal), nilaiBaru: String(newVal ?? '') });
      }
    }

    // Relasi dicatat dengan nama agar log mudah dibaca
    if (updateData.wilayahId !== undefined && updateData.wilayahId !== existing.wilayahId) {
      const wilayah = await prisma.wilayah.findUnique({ where: { id: updateData.wilayahId } });
      if (!wilayah) return res.status(400).json({ success: false, message: 'Wilayah tidak ditemukan' });
      logs.push({ fieldDiubah: 'wilayah', nilaiLama: existing.wilayah?.nama || '', nilaiBaru: wilayah.nama });
    }
    if (updateData.pengelolaId !== undefined && updateData.pengelolaId !== existing.pengelolaId) {
      const pengelola = await prisma.pengelola.findUnique({ where: { id: updateData.pengelolaId } });
      if (!pengelola) return res.status(400).json({ success: false, message: 'Pengelola tidak ditemukan' });
      logs.push({ fieldDiubah: 'pengelola', nilaiLama: existing.pengelola?.nama || '', nilaiBaru: pengelola.nama });
    }

    const diubahOleh = req.user?.name || 'Petugas';
    const [updated] = await prisma.$transaction([
      prisma.fasilitasAir.update({
        where: { id: numericId },
        data: updateData,
        include: fasilitasInclude
      }),
      ...logs.map((log) => prisma.logPembaruan.create({ data: { ...log, fasilitasId: numericId, diubahOleh } })),
    ]);

    res.json({
      success: true,
      message: logs.length ? 'Data titik berhasil diperbarui' : 'Tidak ada perubahan data',
      changes: logs.length,
      data: transformFasilitas(updated)
    });
  } catch (error) {
    handlePrismaError(res, error, 'Gagal memperbarui data titik');
  }
};

// DELETE /api/fasilitas/:id
const deleteFasilitas = async (req, res) => {
  try {
    const numericId = parseInt(req.params.id, 10);
    if (isNaN(numericId)) return res.status(400).json({ success: false, message: 'ID titik tidak valid' });

    const existing = await prisma.fasilitasAir.findUnique({ where: { id: numericId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Data titik tidak ditemukan' });

    // Log perubahan ikut terhapus (onDelete: Cascade)
    await prisma.fasilitasAir.delete({ where: { id: numericId } });

    res.json({ success: true, message: `Titik ${existing.nodeId} berhasil dihapus` });
  } catch (error) {
    handlePrismaError(res, error, 'Gagal menghapus data titik');
  }
};

// GET /api/stats
const getStats = async (req, res) => {
  try {
    const [total, byKategori, byStatus, byJenis, wilayahStats, latest] = await Promise.all([
      prisma.fasilitasAir.count(),
      prisma.fasilitasAir.groupBy({ by: ['kategori'], _count: { id: true } }),
      prisma.fasilitasAir.groupBy({ by: ['statusOperasional'], _count: { id: true } }),
      prisma.fasilitasAir.groupBy({ by: ['jenisFasilitas'], _count: { id: true } }),
      // Grouping per wilayah lewat relasi
      prisma.wilayah.findMany({
        include: { _count: { select: { fasilitas: true } } }
      }),
      prisma.fasilitasAir.aggregate({ _max: { updatedAt: true } }),
    ]);

    const kategoriCount = Object.fromEntries(byKategori.map(k => [k.kategori, k._count.id]));
    const statusMap     = Object.fromEntries(byStatus.map(s => [s.statusOperasional, s._count.id]));
    const jenisMap      = Object.fromEntries(byJenis.map(j => [j.jenisFasilitas, j._count.id]));
    const wilayahMap    = Object.fromEntries(wilayahStats.map(w => [w.nama, w._count.fasilitas]));

    const provinsiMap = {};
    for (const w of wilayahStats) {
      provinsiMap[w.provinsi] = (provinsiMap[w.provinsi] || 0) + w._count.fasilitas;
    }
    const wilayahTerisi = wilayahStats.filter((w) => w._count.fasilitas > 0);

    res.json({
      success: true,
      data: {
        total,
        normal:         statusMap['Beroperasi Normal'] || 0,
        pemeliharaan:   statusMap['Pemeliharaan'] || 0,
        debitMenurun:   statusMap['Debit Menurun'] || 0,
        rusak:          statusMap['Rusak'] || 0,
        byKategori: Object.fromEntries(KATEGORI.map((k) => [k, kategoriCount[k] || 0])),
        byProvinsi: provinsiMap,
        byWilayah:  wilayahMap,
        byJenis:    jenisMap,
        jumlahWilayah:  wilayahTerisi.length,
        jumlahProvinsi: new Set(wilayahTerisi.map((w) => w.provinsi)).size,
        lastUpdated: latest._max.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data statistik', error: error.message });
  }
};

// GET /api/wilayah  - daftar wilayah untuk dropdown (urut provinsi barat → timur sesuai seed)
const getWilayah = async (req, res) => {
  try {
    const data = await prisma.wilayah.findMany({ orderBy: { id: 'asc' } });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data wilayah', error: error.message });
  }
};

// GET /api/pengelola  - daftar pengelola untuk dropdown
const getPengelola = async (req, res) => {
  try {
    const data = await prisma.pengelola.findMany({ orderBy: { nama: 'asc' } });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data pengelola', error: error.message });
  }
};

// Tipe pengelola ditebak dari nama pengelola baru yang diketik petugas
function inferTipePengelola(nama) {
  const val = nama.toLowerCase();
  if (/pamsimas|kpspams|hippam/.test(val)) return 'PAMSIMAS';
  if (/pemerintah|pemkot|pemkab|pemprov|dinas|bbws/.test(val)) return 'PEMDA';
  if (/perumda|pdam|pam jaya|tirta/.test(val)) return 'PERUMDA';
  return 'LAINNYA';
}

// POST /api/pengelola  - tambah pengelola baru dari formulir petugas
const createPengelola = async (req, res) => {
  try {
    const nama = String(req.body?.nama ?? '').trim();
    if (!nama) return res.status(400).json({ success: false, message: 'Nama pengelola wajib diisi' });
    if (nama.length > 120) return res.status(400).json({ success: false, message: 'Nama pengelola maksimal 120 karakter' });

    const data = await prisma.pengelola.create({ data: { nama, tipe: inferTipePengelola(nama) } });
    res.status(201).json({ success: true, message: 'Pengelola berhasil ditambahkan', data });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Pengelola dengan nama tersebut sudah ada' });
    }
    console.error('Error creating pengelola:', error);
    res.status(500).json({ success: false, message: 'Gagal menambahkan pengelola', error: error.message });
  }
};

module.exports = {
  getAllFasilitas,
  getFasilitasById,
  createFasilitas,
  updateFasilitas,
  deleteFasilitas,
  getStats,
  getWilayah,
  getPengelola,
  createPengelola,
};
