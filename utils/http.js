// Error tak terduga dicatat di log server; detail internal (pesan Prisma, path file)
// tidak dikirim ke klien
function serverError(res, error, message) {
  console.error(`${message}:`, error);
  return res.status(500).json({ success: false, message });
}

module.exports = { serverError };
