from django.urls import path, include  # type: ignore
from rest_framework import routers  # type: ignore
from rest_framework_simplejwt.views import (  # type: ignore
    TokenObtainPairView,
    TokenRefreshView,
)
from . import views
from .views import TransactionViewSet, BudgetViewSet, RegisterView, UserView, UploadAvatarView, CategoryViewSet, AccountViewSet, GoalViewSet

router = routers.DefaultRouter()
router.register(r'transactions', TransactionViewSet, basename='transaction')
router.register(r'budgets', BudgetViewSet, basename='budget')
router.register(r'categories', CategoryViewSet, basename='category')
router.register(r'accounts', AccountViewSet, basename='account')
router.register(r'goals', GoalViewSet, basename='goal')

urlpatterns = [
    # Frontend
    path('', views.index, name='index'),

    # API Authentication
    path('api/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # Custom API endpoints
    path('api/register/', RegisterView.as_view(), name='register'),
    path('api/user/', UserView.as_view(), name='user'),
    path('api/user/avatar/', UploadAvatarView.as_view(), name='upload_avatar'),

    # Routers for transactions & budgets
    path('api/', include(router.urls)),
]
