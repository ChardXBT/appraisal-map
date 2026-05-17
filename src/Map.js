import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { GoogleMap, useJsApiLoader, Marker, MarkerClusterer } from '@react-google-maps/api';
import { supabase } from './supabaseClient';
import { applySpiralOffset, COORDINATE_PRECISION } from './mapUtils';

const AddAppraisal = lazy(() => import('./AddAppraisal'));

const MAP_CONTAINER_STYLE = { height: '100%', width: '100%' };
const DEFAULT_CENTER = { lat: 43.7, lng: -79.4 };
const DEFAULT_ZOOM = 9;
const APPRAISAL_COLUMNS = [
  'id',
  'address',
  'city',
  'latitude',
  'longitude',
  'appraisal_date',
  'photo_url',
  'pdf_url',
  'folder_files',
  'created_at',
].join(',');
const PAGE_SIZE = 500;
const MAX_PAGES = 100;
const MAX_RECORDS_PER_FETCH = 5000;
const MAP_IDLE_DEBOUNCE_MS = 250;
const AUTOCOMPLETE_DEBOUNCE_MS = 300;
const SIGNED_URL_TTL_SECONDS = 3600;
const SIGNED_URL_REFRESH_BUFFER_MS = 60 * 1000;
const DETAIL_PANEL_WIDTH = 320;
const PRELOAD_LIMIT = 40;
const MARKER_PAN_DURATION_MS = 650;

const MARKER_ICON = {
  path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
  fillColor: '#0d9488',
  fillOpacity: 1,
  strokeColor: '#ffffff',
  strokeWeight: 2,
  scale: 1.6,
  anchor: { x: 12, y: 22 },
};

const createClusterStyle = ({ size, fill, textSize }) => ({
  textColor: '#ffffff',
  textSize,
  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="${fill}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 3}" fill="none" stroke="#ffffff" stroke-width="2"/>
    </svg>
  `),
  height: size,
  width: size,
  anchorText: [0, 0],
});

const CLUSTER_STYLES = [
  createClusterStyle({
    size: 34,
    fill: '#34d399',
    textSize: 12,
  }),
  createClusterStyle({
    size: 38,
    fill: '#10b981',
    textSize: 12,
  }),
  createClusterStyle({
    size: 42,
    fill: '#059669',
    textSize: 13,
  }),
  createClusterStyle({
    size: 46,
    fill: '#047857',
    textSize: 13,
  }),
];

const MarkerLayer = React.memo(function MarkerLayer({ appraisals, onMarkerClick, onMarkerHover }) {
  return (
    <MarkerClusterer
      styles={CLUSTER_STYLES}
      calculator={(markers) => {
        const count = markers.length;
        let index = 1;
        if (count >= 75) index = 4;
        else if (count >= 30) index = 3;
        else if (count >= 10) index = 2;
        return {
          text: String(count),
          index,
          title: `${count} appraisals`,
        };
      }}
    >
      {(clusterer) => (
        <>
          {appraisals.map((appraisal) => (
            <Marker
              key={appraisal.id}
              clusterer={clusterer}
              position={{ lat: appraisal.latitude, lng: appraisal.longitude }}
              icon={MARKER_ICON}
              onClick={() => onMarkerClick(appraisal)}
              onMouseOver={() => onMarkerHover(appraisal)}
            />
          ))}
        </>
      )}
    </MarkerClusterer>
  );
});

const AppraisalPopup = React.memo(function AppraisalPopup({ appraisal, getSignedUrl, onUpdated, onDeleted }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [fileUrls, setFileUrls] = useState([]);
  const [editing, setEditing] = useState(false);
  const [editAddress, setEditAddress] = useState(appraisal.address);
  const [editCity, setEditCity] = useState(appraisal.city);
  const [editDate, setEditDate] = useState(appraisal.appraisal_date || '');
  const [newPhoto, setNewPhoto] = useState(null);
  const [newFolderFiles, setNewFolderFiles] = useState([]);
  const [newPdf, setNewPdf] = useState(null);
  const [editUploadType, setEditUploadType] = useState('pdf');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setEditAddress(appraisal.address);
    setEditCity(appraisal.city);
    setEditDate(appraisal.appraisal_date || '');
    setNewPhoto(null);
    setNewFolderFiles([]);
    setNewPdf(null);
    setEditUploadType(appraisal.folder_files?.length ? 'folder' : 'pdf');
    setConfirmDelete(false);
  }, [appraisal]);

  useEffect(() => {
    let active = true;

    const loadSignedUrls = async () => {
      if (appraisal.photo_url) {
        const url = await getSignedUrl('photos', appraisal.photo_url);
        if (active) setPhotoUrl(url);
      } else if (active) {
        setPhotoUrl(null);
      }

      if (appraisal.pdf_url) {
        const url = await getSignedUrl('pdfs', appraisal.pdf_url);
        if (active) setPdfUrl(url);
      } else if (active) {
        setPdfUrl(null);
      }

      if (appraisal.folder_files && appraisal.folder_files.length > 0) {
        const urls = await Promise.all(
          appraisal.folder_files.map(async (filePath) => {
            const url = await getSignedUrl('appraisal-folders', filePath);
            const name = filePath.split('_').slice(1).join('_');
            return { name, url, path: filePath };
          })
        );
        if (active) setFileUrls(urls);
      } else if (active) {
        setFileUrls([]);
      }
    };

    loadSignedUrls();
    return () => {
      active = false;
    };
  }, [appraisal, getSignedUrl]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = { address: editAddress, city: editCity, appraisal_date: editDate || null };

      if (editAddress !== appraisal.address || editCity !== appraisal.city) {
        const result = await new Promise((resolve, reject) => {
          const geocoder = new window.google.maps.Geocoder();
          geocoder.geocode(
            { address: `${editAddress}, ${editCity}, Ontario, Canada` },
            (results, status) => {
              if (status === 'OK' && results[0]) resolve(results[0]);
              else reject(new Error('Updated address not found. Please check the spelling.'));
            }
          );
        });
        updates.latitude = result.geometry.location.lat();
        updates.longitude = result.geometry.location.lng();
      }

      const oldStoragePaths = [];
      if (newPhoto) {
        const photoName = `${Date.now()}_${newPhoto.name}`;
        const { error: photoError } = await supabase.storage.from('photos').upload(photoName, newPhoto);
        if (photoError) throw photoError;
        updates.photo_url = photoName;
        if (appraisal.photo_url) oldStoragePaths.push({ bucket: 'photos', path: appraisal.photo_url });
      }

      if (editUploadType === 'pdf' && newPdf) {
        const pdfName = `${Date.now()}_${newPdf.name}`;
        const { error: pdfError } = await supabase.storage.from('pdfs').upload(pdfName, newPdf);
        if (pdfError) throw pdfError;
        updates.pdf_url = pdfName;
        updates.folder_files = null;
        if (appraisal.pdf_url) oldStoragePaths.push({ bucket: 'pdfs', path: appraisal.pdf_url });
        if (appraisal.folder_files?.length) {
          appraisal.folder_files.forEach((path) => oldStoragePaths.push({ bucket: 'appraisal-folders', path }));
        }
      }

      if (editUploadType === 'folder' && newFolderFiles.length > 0) {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        for (const file of newFolderFiles) {
          zip.file(file.webkitRelativePath || file.name, file);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipName = `${Date.now()}_${editAddress.replace(/\s+/g, '_')}.zip`;
        const { error: zipError } = await supabase.storage.from('appraisal-folders').upload(zipName, zipBlob);
        if (zipError) throw zipError;
        updates.folder_files = [zipName];
        updates.pdf_url = null;
        if (appraisal.folder_files?.length) {
          appraisal.folder_files.forEach((path) => oldStoragePaths.push({ bucket: 'appraisal-folders', path }));
        }
        if (appraisal.pdf_url) oldStoragePaths.push({ bucket: 'pdfs', path: appraisal.pdf_url });
      }

      const { error } = await supabase
        .from('appraisals')
        .update(updates)
        .eq('id', appraisal.id);

      if (error) throw error;
      await Promise.all(
        oldStoragePaths.map(async ({ bucket, path }) => {
          const { error: removeError } = await supabase.storage.from(bucket).remove([path]);
          if (removeError) console.error(`Error removing old ${bucket} object:`, removeError);
        })
      );
      setEditing(false);
      onUpdated();
    } catch (err) {
      alert('Error saving: ' + err.message);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    try {
      const storagePaths = [
        ...(appraisal.photo_url ? [{ bucket: 'photos', path: appraisal.photo_url }] : []),
        ...(appraisal.pdf_url ? [{ bucket: 'pdfs', path: appraisal.pdf_url }] : []),
        ...((appraisal.folder_files || []).map((path) => ({ bucket: 'appraisal-folders', path }))),
      ];
      const { error } = await supabase
        .from('appraisals')
        .delete()
        .eq('id', appraisal.id);
      if (error) throw error;
      await Promise.all(
        storagePaths.map(async ({ bucket, path }) => {
          const { error: removeError } = await supabase.storage.from(bucket).remove([path]);
          if (removeError) console.error(`Error removing deleted ${bucket} object:`, removeError);
        })
      );
      onDeleted();
    } catch (err) {
      alert('Error deleting: ' + err.message);
    }
  };

  const getFileIcon = (name) => {
    if (name.match(/\.(pdf)$/i)) return '📄';
    if (name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return '🖼️';
    if (name.match(/\.(doc|docx)$/i)) return '📝';
    if (name.match(/\.(xls|xlsx)$/i)) return '📊';
    return '📎';
  };

  const inputStyle = {
    width: '100%', padding: '8px 10px', marginBottom: '8px', borderRadius: '6px',
    border: '1px solid #d1d5db', fontSize: '13px', boxSizing: 'border-box', outline: 'none',
  };

  if (editing) {
    return (
      <div style={{ fontFamily: "'DM Sans', sans-serif", width: '100%', padding: '20px' }}>
        <p style={{ margin: '0 0 10px', fontWeight: '700', fontSize: '15px', color: '#1f2937' }}>Edit Appraisal</p>
        <input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} style={inputStyle} placeholder="Address" />
        <input type="text" value={editCity} onChange={(e) => setEditCity(e.target.value)} style={inputStyle} placeholder="City" />
        <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '3px' }}>Report Date</label>
        <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={inputStyle} />

        <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '3px' }}>Replace Photo</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', marginBottom: '8px', cursor: 'pointer', background: 'white' }}>
          <span style={{ padding: '2px 8px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '11px' }}>Choose File</span>
          <span style={{ fontSize: '11px', color: newPhoto ? '#374151' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {newPhoto ? newPhoto.name : 'No file chosen'}
          </span>
          <input type="file" accept="image/*" onChange={(e) => setNewPhoto(e.target.files[0])} style={{ display: 'none' }} />
        </label>

        <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>Replace Documents</label>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
          {['pdf', 'folder'].map((type) => (
            <button key={type} type="button" onClick={() => {
              setEditUploadType(type);
              if (type === 'pdf') setNewFolderFiles([]);
              if (type === 'folder') setNewPdf(null);
            }} style={{
              flex: 1, padding: '5px', fontSize: '11px', fontWeight: '600', borderRadius: '4px', cursor: 'pointer',
              backgroundColor: editUploadType === type ? '#0d9488' : 'white',
              color: editUploadType === type ? 'white' : '#374151',
              border: '1px solid ' + (editUploadType === type ? '#0d9488' : '#d1d5db'),
            }}>
              {type === 'pdf' ? 'Single PDF' : 'Folder'}
            </button>
          ))}
        </div>

        {editUploadType === 'pdf' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', marginBottom: '8px', cursor: 'pointer', background: 'white' }}>
            <span style={{ padding: '2px 8px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '11px' }}>Choose PDF</span>
            <span style={{ fontSize: '11px', color: newPdf ? '#374151' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {newPdf ? newPdf.name : 'No file chosen'}
            </span>
            <input type="file" accept=".pdf" onChange={(e) => setNewPdf(e.target.files[0])} style={{ display: 'none' }} />
          </label>
        )}

        {editUploadType === 'folder' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', marginBottom: '8px', cursor: 'pointer', background: 'white' }}>
            <span style={{ padding: '2px 8px', backgroundColor: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '11px' }}>Choose Folder</span>
            <span style={{ fontSize: '11px', color: newFolderFiles.length > 0 ? '#374151' : '#9ca3af' }}>
              {newFolderFiles.length > 0 ? `${newFolderFiles.length} files` : 'No folder chosen'}
            </span>
            <input type="file" webkitdirectory="" mozdirectory="" directory="" multiple onChange={(e) => setNewFolderFiles(Array.from(e.target.files))} style={{ display: 'none' }} />
          </label>
        )}

        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '8px', backgroundColor: '#0d9488', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)} style={{ flex: 1, padding: '8px', backgroundColor: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", width: '100%', display: 'flex', flexDirection: 'column' }}>
      {photoUrl && (
        <img src={photoUrl} alt={appraisal.address} style={{ width: '100%', height: '180px', objectFit: 'cover', display: 'block' }} />
      )}
      <div style={{ padding: '18px 18px 14px' }}>
      <p style={{ margin: '0 0 4px', fontWeight: '700', color: '#1f2937', fontSize: '18px', lineHeight: 1.25 }}>{appraisal.address}</p>
      <p style={{ margin: '0 0 4px', color: '#6b7280', fontSize: '14px' }}>{appraisal.city}</p>
      {appraisal.appraisal_date && (
        <p style={{ margin: 0, color: '#9ca3af', fontSize: '12px' }}>
          Report: {new Date(appraisal.appraisal_date).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}
        </p>
      )}
      </div>

      {fileUrls.length > 0 && (
        <div style={{ margin: '0 18px 14px', maxHeight: '120px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
          {fileUrls.map((file, i) => (
            <a key={i} href={file.url} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', fontSize: '12px', color: '#374151', textDecoration: 'none', borderBottom: i < fileUrls.length - 1 ? '1px solid #f3f4f6' : 'none' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f0fdfa'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
            >
              <span>{getFileIcon(file.name)}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
            </a>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', padding: '0 18px 18px' }}>
        <button onClick={() => setEditing(true)} style={{ flex: 1, padding: '11px 14px', background: 'transparent', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>
          Edit
        </button>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} style={{ flex: 1, padding: '11px 14px', background: 'transparent', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>
            Delete
          </button>
        ) : (
          <button onClick={handleDelete} style={{ flex: 1, padding: '11px 14px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>
            Confirm Delete
          </button>
        )}
      </div>

      {pdfUrl && (
        <div style={{ padding: '0 18px 18px' }}>
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: '12px 14px', background: '#0d9488', color: 'white', borderRadius: '8px', textDecoration: 'none', fontSize: '14px', fontWeight: '600' }}>
            View Report (PDF)
          </a>
        </div>
      )}
    </div>
  );
});

function MapView({ showToast = () => {} }) {
  const [appraisals, setAppraisals] = useState([]);
  const [selectedAppraisalId, setSelectedAppraisalId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const mapRef = useRef(null);
  const autocompleteTimer = useRef(null);
  const mapIdleTimer = useRef(null);
  const fileUrlCacheRef = useRef(new Map());
  const preloadedImageUrlsRef = useRef(new Set());
  const lastBoundsRef = useRef(null);
  const lastFetchKeyRef = useRef(null);
  const latestFetchIdRef = useRef(0);
  const selectedAppraisalIdRef = useRef(null);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY,
    libraries: ['places'],
  });

  const mapOptions = useMemo(() => ({
    restriction: {
      latLngBounds: { north: 44.8, south: 42.8, east: -77.0, west: -81.5 },
      strictBounds: false,
    },
    gestureHandling: 'greedy',
    minZoom: 8,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
    styles: [
      {
        featureType: 'poi',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'transit',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'administrative.land_parcel',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'administrative.neighborhood',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'landscape.man_made',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'road',
        elementType: 'labels.icon',
        stylers: [{ visibility: 'off' }],
      },
    ],
  }), []);

  const onMapLoad = useCallback((map) => {
    mapRef.current = map;
  }, []);

  const selectedAppraisal = useMemo(
    () => appraisals.find((appraisal) => appraisal.id === selectedAppraisalId) || null,
    [appraisals, selectedAppraisalId]
  );

  useEffect(() => {
    selectedAppraisalIdRef.current = selectedAppraisalId;
  }, [selectedAppraisalId]);

  const fetchAppraisals = useCallback(async (bounds = null) => {
    const fetchId = ++latestFetchIdRef.current;
    try {
      let baseQuery = supabase
        .from('appraisals')
        .select(APPRAISAL_COLUMNS, { count: 'exact' })
        .order('created_at', { ascending: false });

      if (bounds) {
        baseQuery = baseQuery
          .gte('latitude', bounds.south)
          .lte('latitude', bounds.north)
          .gte('longitude', bounds.west)
          .lte('longitude', bounds.east);
      }

      const { data: firstPage, count, error } = await baseQuery.range(0, PAGE_SIZE - 1);
      if (error) throw error;
      const allData = firstPage || [];
      const cappedTotalCount = Math.min(count || 0, MAX_RECORDS_PER_FETCH);
      const totalPages = Math.min(Math.ceil(cappedTotalCount / PAGE_SIZE), MAX_PAGES);

      for (let page = 1; page < totalPages; page += 1) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        let query = supabase
          .from('appraisals')
          .select(APPRAISAL_COLUMNS)
          .order('created_at', { ascending: false })
          .range(from, to);

        if (bounds) {
          query = query
            .gte('latitude', bounds.south)
            .lte('latitude', bounds.north)
            .gte('longitude', bounds.west)
            .lte('longitude', bounds.east);
        }

        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData.push(...data);
      }

      if (fetchId === latestFetchIdRef.current) {
        const nextAppraisals = applySpiralOffset(allData);
        setAppraisals(nextAppraisals);
        const activeSelectedAppraisalId = selectedAppraisalIdRef.current;
        if (activeSelectedAppraisalId && !nextAppraisals.some((appraisal) => appraisal.id === activeSelectedAppraisalId)) {
          setSelectedAppraisalId(null);
        }
      }
    } catch (error) {
      console.error('Error loading appraisals:', error);
    }
  }, []);

  useEffect(() => {
    fetchAppraisals();
    return () => {
      if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
      if (mapIdleTimer.current) clearTimeout(mapIdleTimer.current);
    };
  }, [fetchAppraisals]);

  const handleMapIdle = useCallback(() => {
    if (mapIdleTimer.current) clearTimeout(mapIdleTimer.current);
    mapIdleTimer.current = setTimeout(() => {
      if (!mapRef.current) return;
      const bounds = mapRef.current.getBounds();
      if (!bounds) return;
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const nextBounds = {
        north: ne.lat(),
        south: sw.lat(),
        east: ne.lng(),
        west: sw.lng(),
      };
      const fetchKey = [
        nextBounds.north.toFixed(COORDINATE_PRECISION),
        nextBounds.south.toFixed(COORDINATE_PRECISION),
        nextBounds.east.toFixed(COORDINATE_PRECISION),
        nextBounds.west.toFixed(COORDINATE_PRECISION),
      ].join('|');
      if (lastFetchKeyRef.current === fetchKey) return;
      lastFetchKeyRef.current = fetchKey;
      lastBoundsRef.current = nextBounds;
      fetchAppraisals(nextBounds);
    }, MAP_IDLE_DEBOUNCE_MS);
  }, [fetchAppraisals]);

  const handleAutocomplete = useCallback((value) => {
    if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    if (value.length < 3) {
      setSuggestions([]);
      return;
    }

    autocompleteTimer.current = setTimeout(() => {
      const service = new window.google.maps.places.AutocompleteService();
      service.getPlacePredictions(
        {
          input: value,
          componentRestrictions: { country: 'ca' },
          bounds: new window.google.maps.LatLngBounds(
            { lat: 42.8, lng: -81.5 },
            { lat: 44.8, lng: -77.0 }
          ),
        },
        (predictions, status) => {
          if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
            setSuggestions(predictions.slice(0, 5));
          } else {
            setSuggestions([]);
          }
        }
      );
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  }, []);

  const handleSearch = useCallback(async () => {
    if (!searchTerm.trim()) return;
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode(
      {
        address: searchTerm + ', Ontario, Canada',
        componentRestrictions: { country: 'ca' },
      },
      (results, status) => {
        if (status === 'OK' && results[0] && mapRef.current) {
          mapRef.current.panTo(results[0].geometry.location);
          mapRef.current.setZoom(17);
          setSuggestions([]);
        } else {
          alert('Location not found. Try a different address.');
        }
      }
    );
  }, [searchTerm]);

  const getSignedUrl = useCallback(async (bucket, path) => {
    const key = `${bucket}/${path}`;
    const cached = fileUrlCacheRef.current.get(key);
    if (cached && cached.expiresAt - SIGNED_URL_REFRESH_BUFFER_MS > Date.now()) return cached.url;
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data) return null;
    fileUrlCacheRef.current.set(key, {
      url: data.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
    });
    return data.signedUrl;
  }, []);

  const preloadImage = useCallback((url) => {
    if (!url || preloadedImageUrlsRef.current.has(url)) return;
    preloadedImageUrlsRef.current.add(url);
    const image = new Image();
    image.src = url;
  }, []);

  useEffect(() => {
    let active = true;

    const warmVisibleAssets = async () => {
      const visibleAppraisals = appraisals.slice(0, PRELOAD_LIMIT);
      await Promise.all(
        visibleAppraisals.map(async (appraisal) => {
          if (appraisal.photo_url) {
            const photoUrl = await getSignedUrl('photos', appraisal.photo_url);
            if (active) preloadImage(photoUrl);
          }
          if (appraisal.pdf_url) {
            await getSignedUrl('pdfs', appraisal.pdf_url);
          }
        })
      );
    };

    if (appraisals.length > 0) warmVisibleAssets();
    return () => {
      active = false;
    };
  }, [appraisals, getSignedUrl, preloadImage]);

  const handleMarkerClick = useCallback((appraisal) => {
    setSelectedAppraisalId(appraisal.id);
    if (mapRef.current) {
      const map = mapRef.current;
      const start = map.getCenter();
      if (!start) return;

      const startLat = start.lat();
      const startLng = start.lng();
      const endLat = appraisal.latitude;
      const endLng = appraisal.longitude;
      const startTime = performance.now();

      const easeInOut = (t) => (
        t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      );

      const animate = (now) => {
        const progress = Math.min((now - startTime) / MARKER_PAN_DURATION_MS, 1);
        const eased = easeInOut(progress);
        map.setCenter({
          lat: startLat + (endLat - startLat) * eased,
          lng: startLng + (endLng - startLng) * eased,
        });
        if (progress < 1) requestAnimationFrame(animate);
      };

      requestAnimationFrame(animate);
    }
  }, []);

  const handleMarkerHover = useCallback(async (appraisal) => {
    if (appraisal.photo_url) {
      const photoUrl = await getSignedUrl('photos', appraisal.photo_url);
      preloadImage(photoUrl);
    }
    if (appraisal.pdf_url) {
      await getSignedUrl('pdfs', appraisal.pdf_url);
    }
  }, [getSignedUrl, preloadImage]);

  const handleSuggestionClick = useCallback((suggestion) => {
    setSearchTerm(suggestion.description);
    setSuggestions([]);
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ placeId: suggestion.place_id }, (results, status) => {
      if (status === 'OK' && results[0] && mapRef.current) {
        mapRef.current.panTo(results[0].geometry.location);
        mapRef.current.setZoom(17);
      }
    });
  }, []);

  const handleAddToggle = useCallback(() => {
    setShowAdd((prev) => !prev);
  }, []);

  const handleSignOut = useCallback(() => {
    supabase.auth.signOut();
  }, []);

  const handleAppraisalAdded = useCallback(() => {
    fetchAppraisals(lastBoundsRef.current);
    setShowAdd(false);
  }, [fetchAppraisals]);

  const handleAppraisalUpdated = useCallback(() => {
    fetchAppraisals(lastBoundsRef.current);
    setSelectedAppraisalId(null);
    showToast('Appraisal updated');
  }, [fetchAppraisals, showToast]);

  const handleAppraisalDeleted = useCallback(() => {
    fetchAppraisals(lastBoundsRef.current);
    setSelectedAppraisalId(null);
    showToast('Appraisal deleted');
  }, [fetchAppraisals, showToast]);

  if (loadError) return <div style={{ padding: '20px', color: '#dc2626' }}>Error loading Google Maps. Check your API key.</div>;

  return (
    <div style={{ height: '100vh', width: '100%', fontFamily: "'DM Sans', sans-serif" }}>

      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: '56px',
        background: '#ffffff', borderBottom: '1px solid #e5e7eb',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', zIndex: 1000, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, maxWidth: '500px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: '#f3f4f6', borderRadius: '8px', padding: '0 12px', flex: 1, position: 'relative' }}>
            <input
              type="text"
              placeholder="Search address, city, or area..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); handleAutocomplete(e.target.value); }}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              style={{ border: 'none', background: 'none', padding: '10px 0', fontSize: '14px', outline: 'none', width: '100%', color: '#374151' }}
            />
            {suggestions.length > 0 && (
              <div style={{ position: 'absolute', top: '42px', left: 0, right: 0, background: 'white', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 2000 }}>
                {suggestions.map((s, i) => (
                  <div key={i}
                    onClick={() => handleSuggestionClick(s)}
                    style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '13px', color: '#374151', borderBottom: '1px solid #f3f4f6' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f0fdfa'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
                  >
                    {s.description}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleSearch} style={{ padding: '10px 18px', backgroundColor: '#0d9488', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap' }}>
            Search
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={handleAddToggle}
            style={{ padding: '9px 16px', backgroundColor: showAdd ? '#dc2626' : '#0d9488', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', transition: 'background 0.2s' }}
          >
            {showAdd ? '✕ Close' : '+ Add'}
          </button>
          <button
            onClick={handleSignOut}
            style={{ padding: '9px 16px', backgroundColor: 'transparent', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}
          >
            Log out
          </button>
        </div>
      </div>

      {showAdd && (
        <Suspense fallback={null}>
          <AddAppraisal onAdded={handleAppraisalAdded} />
        </Suspense>
      )}

      <div style={{ paddingTop: '56px', height: '100%' }}>
        {!isLoaded ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', fontSize: '14px' }}>
            Loading map...
          </div>
        ) : (
          <GoogleMap
            mapContainerStyle={MAP_CONTAINER_STYLE}
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            onLoad={onMapLoad}
            onIdle={handleMapIdle}
            onClick={() => setSelectedAppraisalId(null)}
            options={mapOptions}
          >
            <MarkerLayer appraisals={appraisals} onMarkerClick={handleMarkerClick} onMarkerHover={handleMarkerHover} />
          </GoogleMap>
        )}
      </div>

      {selectedAppraisal && (
        <div style={{
          position: 'fixed',
          top: '76px',
          left: '20px',
          width: `${DETAIL_PANEL_WIDTH}px`,
          maxWidth: '92vw',
          maxHeight: 'calc(100vh - 96px)',
          overflowY: 'auto',
          background: 'white',
          borderRadius: '14px',
          boxShadow: '0 10px 28px rgba(0,0,0,0.18)',
          zIndex: 1000,
        }}>
          <button
            onClick={() => setSelectedAppraisalId(null)}
            aria-label="Close appraisal details"
            style={{
              position: 'absolute',
              top: '14px',
              right: '14px',
              width: '28px',
              height: '28px',
              borderRadius: '999px',
              border: 'none',
              background: 'rgba(17, 24, 39, 0.72)',
              color: 'white',
              cursor: 'pointer',
              fontSize: '16px',
              lineHeight: 1,
              zIndex: 1,
            }}
          >
            ×
          </button>
          <AppraisalPopup
            appraisal={selectedAppraisal}
            getSignedUrl={getSignedUrl}
            onUpdated={handleAppraisalUpdated}
            onDeleted={handleAppraisalDeleted}
          />
        </div>
      )}
    </div>
  );
}

export default MapView;
