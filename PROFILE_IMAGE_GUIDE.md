# Profile Image Upload & Management Guide

## Overview
The Daily Dime application now includes a comprehensive profile image editing system that allows users to upload, replace, and manage their avatar images. All images are properly validated, processed, and stored in the database.

## Features

### Image Upload
- **Format Support**: JPG, PNG, GIF, WebP
- **Max Size**: 5MB per image
- **Auto-Processing**: 
  - Converts all images to JPEG format (85% quality)
  - Crops to center square
  - Resizes to 400x400 pixels
  - Optimizes file size

### Image Storage
- **Location**: `media/avatars/` directory
- **Database**: Avatar path stored in `Profile.avatar` model field
- **Naming**: `avatars/{user_id}_{timestamp}_{filename}.jpg`
- **Old Files**: Previous avatars are automatically deleted when replaced

### Validation
- ✅ File type validation (only image formats allowed)
- ✅ File size check (5MB maximum)
- ✅ Image format validation
- ✅ User permission checks (authenticated users only)

## How to Use

### As a User

1. **Navigate to Profile**
   - Click "Profile" in the sidebar navigation

2. **Edit Profile**
   - Click the "Edit Profile" button in the Account Information section

3. **Change Avatar**
   - Hover over your current avatar image
   - Click the "Change avatar" button that appears
   - Select an image file from your device
   - The preview will update immediately

4. **Save Changes**
   - Review all your profile information
   - Click "Save" to save all changes
   - Your avatar will be uploaded and processed
   - The profile page will refresh with your new image

### Avatar Preview in Sidebar
- Your current avatar displays in the sidebar footer
- Updates automatically after saving profile changes

## API Endpoints

### Upload Avatar
**Endpoint**: `POST /api/user/avatar/`

**Request**:
```bash
curl -X POST http://localhost:8000/api/user/avatar/ \
  -H "Authorization: Bearer {token}" \
  -F "avatar=@/path/to/image.jpg"
```

**Response**:
```json
{
  "avatar": "/media/avatars/1_1234567890_photo.jpg",
  "message": "Avatar uploaded successfully"
}
```

**Error Response**:
```json
{
  "error": "File too large. Maximum size is 5MB"
}
```

### Get User Profile (includes avatar)
**Endpoint**: `GET /api/user/`

**Response**:
```json
{
  "id": 1,
  "username": "john_doe",
  "email": "john@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "profile": {
    "phone": "555-1234",
    "address": "123 Main St",
    "date_of_birth": "1990-01-01",
    "avatar": "avatars/1_1234567890_photo.jpg",
    "premium": false
  }
}
```

### Update Profile (with avatar in form data)
**Endpoint**: `PUT /api/user/`

**Request**:
```bash
curl -X PUT http://localhost:8000/api/user/ \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com",
    "profile": {
      "phone": "555-1234",
      "address": "123 Main St"
    }
  }'
```

## Database Schema

### Profile Model
```python
class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    premium = models.BooleanField(default=False)
```

The `avatar` field stores the relative path to the image file. Full URLs are constructed by prepending `/media/` to the path.

## Technical Details

### Backend Processing (views.py)
- **UploadAvatarView**: Handles all image uploads
- **Validation**: File type, size, and format checks
- **Processing**: Uses Pillow (PIL) for image manipulation
- **Fallback**: Raw file save if Pillow is unavailable
- **Cleanup**: Deletes old avatars when replaced

### Frontend Handling (main.js)
- **Client-side Validation**: File type and size checks before upload
- **Preview**: Shows image preview before saving
- **Error Handling**: Displays user-friendly error messages
- **Feedback**: Confirmation of successful uploads

## File Structure
```
media/
├── avatars/
│   ├── 1_1234567890_photo.jpg
│   ├── 2_1234567891_selfie.jpg
│   └── ...
finance/
├── models.py          # Profile model with avatar field
├── views.py           # UploadAvatarView
├── serializers.py     # ProfileSerializer
├── urls.py            # API routes
├── static/
│   └── finance/
│       └── main.js    # Frontend profile logic
└── templates/
    └── finance/
        └── index.html # Profile page HTML
```

## Error Handling

### Common Errors and Solutions

**"File too large. Maximum size is 5MB"**
- Reduce image file size before uploading
- Use image compression tools

**"Invalid file type"**
- Only JPG, PNG, GIF, and WebP formats are supported
- Convert your image to one of these formats

**"Network error uploading avatar"**
- Check your internet connection
- Verify the server is running
- Check browser console for details

**"Failed to upload avatar"**
- Check file permissions in the `media/avatars/` directory
- Ensure the `media` directory exists and is writable
- Check server logs for detailed error information

## Database Migrations

The avatar field is included in the initial migration:
```
finance/migrations/0001_initial.py
```

To apply migrations:
```bash
python manage.py migrate
```

## Settings Configuration

The following settings in `daily_dime/settings.py` enable media file serving:

```python
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
```

In development, media files are served automatically by Django.

## Production Considerations

For production deployment:

1. **Static/Media Serving**:
   - Use a web server (nginx, Apache) to serve media files
   - Or use cloud storage (AWS S3, Azure Blob Storage)
   - Set up appropriate CDN for image caching

2. **Security**:
   - Validate image content (magic bytes)
   - Set proper file permissions
   - Use virus scanning for user uploads
   - Implement rate limiting on upload endpoint

3. **Performance**:
   - Consider using image optimization services
   - Implement caching headers
   - Use CDN for image distribution
   - Monitor storage usage

4. **Storage**:
   - Implement automated cleanup for old avatars
   - Monitor disk space
   - Set up regular backups

## Troubleshooting

### Images not displaying
1. Check if `MEDIA_ROOT` and `MEDIA_URL` are configured correctly
2. Verify `media/avatars/` directory exists
3. Check file permissions (directory should be readable)
4. Clear browser cache and reload

### Avatar not saving to database
1. Verify `Profile` model and migrations are applied
2. Check database migrations: `python manage.py showmigrations`
3. Ensure database is not read-only
4. Check Django logs for SQL errors

### Upload fails with 500 error
1. Check server logs: `tail -f logs/debug.log`
2. Verify Pillow is installed: `pip install Pillow`
3. Check disk space availability
4. Verify media directory permissions

## API Examples

### JavaScript/Fetch
```javascript
async function uploadAvatar(file) {
    const formData = new FormData();
    formData.append('avatar', file);
    
    const response = await fetch('/api/user/avatar/', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        },
        body: formData
    });
    
    if (!response.ok) {
        const error = await response.json();
        console.error(error);
        return;
    }
    
    const result = await response.json();
    console.log('Avatar URL:', result.avatar);
}
```

### Python/Requests
```python
import requests

token = "your_auth_token"
headers = {"Authorization": f"Bearer {token}"}

with open('image.jpg', 'rb') as f:
    files = {'avatar': f}
    response = requests.post(
        'http://localhost:8000/api/user/avatar/',
        headers=headers,
        files=files
    )
    
if response.status_code == 200:
    print(f"Avatar URL: {response.json()['avatar']}")
else:
    print(f"Error: {response.json()['error']}")
```

## Support & Development

For issues or feature requests related to profile images:
1. Check the troubleshooting section above
2. Review server logs for error details
3. Verify all settings are correctly configured
4. Test with different image formats and sizes
