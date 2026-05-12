from django.shortcuts import render  # type: ignore
from django.db.models import Sum  # type: ignore
from django.contrib.auth.models import User  # type: ignore
from rest_framework import viewsets, filters, generics, permissions  # type: ignore
from rest_framework.parsers import MultiPartParser, FormParser  # type: ignore
from rest_framework.decorators import action  # type: ignore
from rest_framework.response import Response  # type: ignore
from rest_framework.permissions import IsAuthenticated  # type: ignore
from rest_framework_simplejwt.tokens import RefreshToken  # type: ignore
from .models import Transaction, Budget, Profile, Category, Account, Goal
from .serializers import TransactionSerializer, BudgetSerializer, UserDetailSerializer, CategorySerializer, AccountSerializer, GoalSerializer
from rest_framework.views import APIView  # type: ignore
from django.core.files.storage import default_storage  # type: ignore
from django.core.files.base import ContentFile  # type: ignore
from io import BytesIO
try:
    from PIL import Image  # type: ignore
    PIL_AVAILABLE = True
except Exception:
    PIL_AVAILABLE = False

from django.db.utils import OperationalError  # type: ignore
import logging  # new


class TransactionViewSet(viewsets.ModelViewSet):
    serializer_class = TransactionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title', 'category', 'description']
    ordering_fields = ['date', 'amount']

    def get_queryset(self):
        return Transaction.objects.filter(user=self.request.user).order_by('-date')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


    @action(detail=False, methods=['get'])
    def recent(self, request):
        qs = Transaction.objects.filter(user=request.user).order_by('-date')[:5]
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)


class BudgetViewSet(viewsets.ModelViewSet):
    serializer_class = BudgetSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Budget.objects.filter(user=self.request.user).order_by('-created_at')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['get'])
    def totals(self, request):
        try:
            total_income = Transaction.objects.filter(user=request.user, transaction_type='income').aggregate(t=Sum('amount'))['t'] or 0
            total_expense = Transaction.objects.filter(user=request.user, transaction_type='expense').aggregate(t=Sum('amount'))['t'] or 0
            total_balance = total_income - total_expense
            return Response({
                'total_income': total_income,
                'total_expense': total_expense,
                'total_balance': total_balance,
            })
        except OperationalError as e:
            # Database not ready (no tables) — return safe defaults
            return Response({'total_income': 0, 'total_expense': 0, 'total_balance': 0}, status=200)


class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        username = request.data.get("username")
        password = request.data.get("password")
        email = request.data.get("email", "")

        if not username or not password:
            return Response({"error": "Username and password required"}, status=400)
        if User.objects.filter(username=username).exists():
            return Response({"error": "Username already exists"}, status=400)

        user = User.objects.create_user(username=username, password=password, email=email)
        refresh = RefreshToken.for_user(user)
        return Response({
            "message": "User registered successfully",
            "refresh": str(refresh),
            "access": str(refresh.access_token),
        })


class UserView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = UserDetailSerializer

    def get_object(self):
        return self.request.user


class UploadAvatarView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]
    MAX_AVATAR_SIZE = 5 * 1024 * 1024  # 5MB max
    ALLOWED_TYPES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}

    def post(self, request):
        if 'avatar' not in request.FILES:
            return Response({'error': 'No file provided'}, status=400)
        
        avatar_file = request.FILES['avatar']
        
        # Validate file size
        if avatar_file.size > self.MAX_AVATAR_SIZE:
            return Response({
                'error': f'File too large. Maximum size is {self.MAX_AVATAR_SIZE // (1024*1024)}MB'
            }, status=400)
        
        # Validate MIME type
        if avatar_file.content_type not in self.ALLOWED_TYPES:
            return Response({
                'error': f'Invalid file type. Allowed types: {", ".join(self.ALLOWED_TYPES)}'
            }, status=400)
        
        try:
            # Get or create profile
            try:
                profile = request.user.profile
            except Exception:
                profile = Profile.objects.create(user=request.user)
            
            # Delete old avatar file if exists
            old_avatar_path = profile.avatar.name if profile.avatar else None
            
            # Create unique filename
            import time
            base_name = avatar_file.name.rsplit('.', 1)[0] if '.' in avatar_file.name else 'avatar'
            ext = avatar_file.name.rsplit('.', 1)[1] if '.' in avatar_file.name else 'jpg'
            # Sanitize extension
            ext = ext.lower()
            if ext not in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                ext = 'jpg'
            filename = f"avatars/{request.user.id}_{int(time.time())}_{base_name}.{ext}"
            
            # Process image with Pillow if available
            if PIL_AVAILABLE:
                try:
                    image = Image.open(avatar_file)
                    # Convert to RGB to handle RGBA and other formats
                    if image.mode in ('RGBA', 'LA', 'P'):
                        # Create white background
                        background = Image.new('RGB', image.size, (255, 255, 255))
                        background.paste(image, mask=image.split()[-1] if image.mode in ('RGBA', 'LA') else None)
                        image = background
                    else:
                        image = image.convert('RGB')
                    
                    # Crop to square (center)
                    width, height = image.size
                    side = min(width, height)
                    left = (width - side) // 2
                    top = (height - side) // 2
                    right = left + side
                    bottom = top + side
                    image = image.crop((left, top, right, bottom))
                    
                    # Resize to 400x400
                    image = image.resize((400, 400), Image.Resampling.LANCZOS)
                    
                    # Save as JPEG
                    buffer = BytesIO()
                    image.save(buffer, format='JPEG', quality=85, optimize=True)
                    buffer.seek(0)
                    content = ContentFile(buffer.read())
                    
                    # Save via ImageField
                    profile.avatar.save(filename, content)
                    profile.save()
                    url = profile.avatar.url
                    
                except Exception as e:
                    logging.error(f"Pillow processing failed for user {request.user.id}: {str(e)}")
                    # Fallback to raw save
                    path = default_storage.save(filename, avatar_file)
                    profile.avatar.name = path
                    profile.save()
                    url = default_storage.url(path)
            else:
                # Pillow not available - fallback to raw save
                path = default_storage.save(filename, avatar_file)
                profile.avatar.name = path
                profile.save()
                url = default_storage.url(path)
            
            # Clean up old avatar file if it exists and is different
            if old_avatar_path and old_avatar_path != profile.avatar.name:
                try:
                    default_storage.delete(old_avatar_path)
                    logging.info(f"Deleted old avatar for user {request.user.id}: {old_avatar_path}")
                except Exception as e:
                    logging.warning(f"Failed to delete old avatar: {str(e)}")
            
            return Response({'avatar': url, 'message': 'Avatar uploaded successfully'})
            
        except Exception as e:
            logging.error(f"Avatar upload error for user {request.user.id}: {str(e)}")
            return Response({'error': 'Failed to upload avatar'}, status=500)

# NEW: Category, Account, Goal viewsets (with DB guards)
class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        try:
            return Category.objects.filter(user=self.request.user).order_by('-created_at')
        except OperationalError:
            return Category.objects.none()

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    # NEW: robust list endpoint (returns JSON on DB error)
    def list(self, request, *args, **kwargs):
        try:
            return super().list(request, *args, **kwargs)
        except OperationalError:
            # DB not ready; return empty list so frontend can continue
            return Response([], status=200)
        except Exception as exc:
            logging.exception("Category list failed")
            return Response({'detail': 'Server error listing categories'}, status=500)


class AccountViewSet(viewsets.ModelViewSet):
    serializer_class = AccountSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        try:
            return Account.objects.filter(user=self.request.user).order_by('-created_at')
        except OperationalError:
            return Account.objects.none()

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    # NEW: robust list endpoint
    def list(self, request, *args, **kwargs):
        try:
            return super().list(request, *args, **kwargs)
        except OperationalError:
            return Response([], status=200)
        except Exception:
            logging.exception("Account list failed")
            return Response({'detail': 'Server error listing accounts'}, status=500)


class GoalViewSet(viewsets.ModelViewSet):
    serializer_class = GoalSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        try:
            return Goal.objects.filter(user=self.request.user).order_by('-created_at')
        except OperationalError:
            return Goal.objects.none()

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    # NEW: robust list endpoint
    def list(self, request, *args, **kwargs):
        try:
            return super().list(request, *args, **kwargs)
        except OperationalError:
            return Response([], status=200)
        except Exception:
            logging.exception("Goal list failed")
            return Response({'detail': 'Server error listing goals'}, status=500)

def index(request):
    return render(request, 'finance/index.html')
