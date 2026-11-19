/**
 * Ambil seluruh titik fasilitas dalam bentuk datar (sama dengan respons GET /api/fasilitas),
 * untuk analisis cakupan dan asisten AI.
 */
const prisma = require('../config/database');
const { serializeFasilitas: datar } = require('../utils/serialize');

async function ambilSemuaFasilitas() {
  const data = await prisma.fasilitasAir.findMany({
    include: { wilayah: true, pengelola: true },
    orderBy: { id: 'asc' },
  });
  return data.map(datar);
}

async function ambilFasilitas(idOrNodeId) {
  const include = { wilayah: true, pengelola: true };
  let item = null;
  if (/^\d+$/.test(String(idOrNodeId))) {
    item = await prisma.fasilitasAir.findUnique({ where: { id: parseInt(idOrNodeId, 10) }, include });
  }
  if (!item) {
    item = await prisma.fasilitasAir.findFirst({
      where: { nodeId: { equals: String(idOrNodeId).trim().toUpperCase() } },
      include,
    });
  }
  return item ? datar(item) : null;
}

module.exports = { ambilSemuaFasilitas, ambilFasilitas };
