/*

import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { origem, destino } = req.body;
  if (!origem || !destino) {
    return res.status(400).json({ error: 'Missing origem or destino' });
  }

  // MAPBOX DIRECTIONS API
  const mapboxToken = '<SEU_MAPBOX_ACCESS_TOKEN>'; // Cole seu token aqui
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?geometries=geojson&access_token=${mapboxToken}`;

  try {
    const mbRes = await fetch(url);
    const data = await mbRes.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch route', details: err });
  }
}

*/
